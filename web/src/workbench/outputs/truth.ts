import { exportIdentity, startExport, useOperations, cancelOperation, isOperationActive, type TruthExportInput } from "@/workbench/operations";

export function useTruthExport(request: TruthExportInput | null) {
  const operations = useOperations();
  const job = (format: 0 | 1) => {
    if (request === null) return undefined;
    const identity = exportIdentity({ ...request, format });
    return operations.find((operation) => operation.kind === "export" && isOperationActive(operation) && operation.identity === identity.key);
  };
  return {
    available: request !== null,
    job,
    start: (format: 0 | 1) => request === null ? null : startExport({ ...request, format }),
    cancel: (format: 0 | 1) => {
      const operation = job(format);
      if (operation !== undefined) cancelOperation(operation.id);
    },
  };
}
