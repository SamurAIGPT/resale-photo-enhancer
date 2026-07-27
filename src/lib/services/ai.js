import { prisma } from "@/lib/prisma";
import { UserService } from "./user";
import config from "@/lib/config";

/**
 * Service to manage AI Photo Enhancer edits using nano-banana-2-edit API
 */
export const AIService = {
  /**
   * Cost in credits per photo enhancement
   */
  getCreditCost() {
    return 12;
  },

  /**
   * Submit an image enhancement task to MuAPI
   */
  async generate(userId, { inputUrl, templateImageUrl, prompt, aspectRatio = "Auto", templateName = null, customApiKey = null }) {
    const isUsingCustomKey = Boolean(customApiKey && customApiKey.trim().length > 0);
    const cost = isUsingCustomKey ? 0 : this.getCreditCost();

    if (!isUsingCustomKey && cost > 0) {
      await UserService.deductCredits(userId, cost);
    }

    const apiKey = isUsingCustomKey ? customApiKey.trim() : config.ai.apiKey;
    if (!apiKey) throw new Error("MUAPIAPP_API_KEY or HEADSHOT_API_KEY is not configured");

    // Submit task
    const submitRes = await fetch(config.ai.submitEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        prompt: prompt,
        images_list: [templateImageUrl, inputUrl],
        aspect_ratio: aspectRatio,
        google_search: false,
        resolution: "1k",
        output_format: "jpg",
        webhook: `${config.auth.webhook_url}/api/webhooks/ai`
      }),
    });

    if (!submitRes.ok) {
      const errorText = await submitRes.text();
      // Refund credits on failure if deducted
      if (!isUsingCustomKey && cost > 0) {
        await UserService.addCredits(userId, cost);
      }
      throw new Error(`API Submission Failed: ${submitRes.status} ${errorText}`);
    }

    const { request_id } = await submitRes.json();
    if (!request_id) {
      if (!isUsingCustomKey && cost > 0) {
        await UserService.addCredits(userId, cost);
      }
      throw new Error("No request_id received from API");
    }

    // Save enhancement record
    const enhancement = await prisma.enhancement.create({
      data: {
        userId,
        inputUrl,
        prompt,
        templateName,
        aspectRatio,
        requestId: request_id,
        status: "processing",
      }
    });

    return enhancement;
  },

  /**
   * Universal method to process AI results from polling or webhooks
   */
  async processResult(requestId, result, customApiKey = null) {
    const enhancement = await prisma.enhancement.findUnique({
      where: { requestId }
    });

    if (!enhancement) return null;

    // If it's already finished in database, return it
    if (enhancement.status === "completed") {
      return { status: "completed", outputUrl: enhancement.outputUrl };
    }

    if (enhancement.status === "failed") {
      return { status: "failed", error: enhancement.error };
    }

    const isUsingCustomKey = Boolean(customApiKey && customApiKey.trim().length > 0);

    // Check if result indicates finished
    const status = result.status || result.state;
    if (status === "completed" || status === "succeeded") {
      const outputs = result.outputs || [];
      const outputUrl = outputs[0] || (typeof result.output === 'string' ? result.output : result.output?.urls?.get);
      
      if (outputUrl) {
        const updated = await prisma.enhancement.update({
          where: { id: enhancement.id },
          data: {
            status: "completed",
            outputUrl: outputUrl,
          }
        });
        return { status: "completed", outputUrl: updated.outputUrl };
      }
    } else if (status === "failed") {
      const errorMsg = result.error || "Prediction failed";
      const updated = await prisma.enhancement.update({
        where: { id: enhancement.id },
        data: {
          status: "failed",
          error: errorMsg,
        }
      });
      // Refund credit on failure if not using custom key
      if (!isUsingCustomKey) {
        await UserService.addCredits(enhancement.userId, this.getCreditCost());
      }
      return { status: "failed", error: updated.error };
    }

    return { status: "processing" };
  },

  /**
   * Check status of generation (either from database or polling MuAPI API)
   */
  async checkStatus(requestId, userId, customApiKey = null) {
    // First check if we already have it in DB
    const res = await this.processResult(requestId, {}, customApiKey);
    if (res && res.status !== "processing") return res;

    // Fallback: poll MuAPI prediction result endpoint
    const apiKey = (customApiKey && customApiKey.trim().length > 0) ? customApiKey.trim() : config.ai.apiKey;
    if (!apiKey) throw new Error("API Key is not configured");

    try {
      const res = await fetch(config.ai.pollEndpoint(requestId), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        }
      });

      if (res.ok) {
        const result = await res.json();
        return await this.processResult(requestId, result, customApiKey);
      }
    } catch (e) {
      console.error("Polling error:", e);
    }

    return { status: "processing" };
  }
};
