import { z } from "zod";

export const emptySchema = z.object({});

export const sandboxNameSchema = z.string().min(1).max(128).describe("Sandbox name");

export const volumeNameSchema = z.string().min(1).max(128).describe("Volume name");

export const outputLimitsSchema = z.object({
  maxBytes: z.number().int().positive().optional().describe("Maximum bytes to return."),
}).optional();
