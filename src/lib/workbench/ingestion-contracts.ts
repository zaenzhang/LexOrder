import { z } from "zod";
import { identifierSchema, indexBindingSchema, sourceAnchorSchema, sourceVersionSchema } from "./contracts";

// These describe observations, not authority to upload or change a business row.
export const ingestionIntentSchema = z.strictObject({
  operationId: z.string().uuid(),
  source: sourceVersionSchema,
  parseGenerationId: identifierSchema,
  indexGenerationId: identifierSchema,
  filename: z.string().min(1).max(240).refine(value => !/[\\/\u0000-\u001f]/.test(value)),
  mimeType: z.string().min(1).max(200),
});

export const ingestionObservationSchema = z.strictObject({
  state: z.enum(["UPLOADED", "PROCESSING", "STOPPING", "COMPLETED", "STOPPED", "FAILED", "ABSENT", "UNKNOWN"]),
  remoteDocumentId: identifierSchema,
  // Acknowledged cancellation/deletion is not observed cancellation/deletion.
  observed: z.boolean(),
});

export const indexWriteSchema = z.strictObject({
  binding: indexBindingSchema,
  anchors: z.array(sourceAnchorSchema).min(1),
});

export const ragCapabilities = {
  LANCEDB: {
    upload: "LOCAL_ORIGINAL_STORE", parse: "LEXORDER_PROVIDER", poll: "LOCAL_JOB",
    cancel: "COOPERATIVE_LOCAL_JOB", delete: "GENERATION_FILTERED_INDEX_DELETE",
    reconcileUpload: "ORIGINAL_SHA256", configurationOwner: "PERSONAL_WORKSPACE",
  },
  RAGFLOW: {
    upload: "ONE_FILE_PER_OPERATION", parse: "REMOTE_ASYNC", poll: "INGESTION_STATUS",
    cancel: "REQUEST_THEN_OBSERVE", delete: "REQUEST_THEN_OBSERVE_ABSENCE",
    reconcileUpload: "UNIQUE_OPERATION_NAME_AND_DOWNLOADED_SHA256", configurationOwner: "SERVER_RAGFLOW",
  },
} as const;

export type IngestionIntent = z.infer<typeof ingestionIntentSchema>;
export type IngestionObservation = z.infer<typeof ingestionObservationSchema>;
