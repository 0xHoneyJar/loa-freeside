/**
 * @freeside/freeside-cli · public API
 *
 * Exports the verb implementations so they can be invoked programmatically
 * (e.g., from the `loa freeside` framework binding, or the FR-6 E2E harness)
 * in addition to via the CLI binary at bin/freeside-cli.
 */

export { listModules, type ListOutput } from "./verbs/list.js";
export { inspectModule, type InspectOptions } from "./verbs/inspect.js";
export {
  doctor,
  type DoctorOptions,
  type DoctorReport,
  type DoctorFinding,
  type Severity,
} from "./verbs/doctor.js";
