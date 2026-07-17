/**
 * @freeside/freeside-cli · public API
 *
 * Exports the verb implementations so they can be invoked programmatically
 * (e.g., from the `loa freeside` framework binding) in addition to via the
 * CLI binary at bin/freeside-cli.
 */

export { listModules } from "./verbs/list.js";
export { inspectModule } from "./verbs/inspect.js";
export { doctor } from "./verbs/doctor.js";
