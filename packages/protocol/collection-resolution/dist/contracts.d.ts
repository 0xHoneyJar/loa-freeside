import { Effect, Schema } from "effect";
import type { ParseOptions } from "effect/SchemaAST";
import { VersionedDigest, decodeCapabilityRegistryVersion } from "@freeside/collection-protocol";
import { ContractIntegrityError } from "./errors.js";
declare const digestKey: (value: VersionedDigest) => string;
declare const isStrictlySortedUnique: <Value>(values: ReadonlyArray<Value>, key: (value: Value) => string) => boolean;
export declare const AuthorizationScope: Schema.Struct<{
    schema_version: Schema.Literal<[1]>;
    subject_id: Schema.refine<string, Schema.filter<typeof Schema.String>>;
    community_ref: Schema.optionalWith<Schema.refine<string, Schema.filter<typeof Schema.String>>, {
        exact: true;
    }>;
    permission: Schema.Literal<["report:create"]>;
}>;
export type AuthorizationScope = Schema.Schema.Type<typeof AuthorizationScope>;
export declare const ResolutionEnvironment: Schema.Literal<["mainnet"]>;
export type ResolutionEnvironment = Schema.Schema.Type<typeof ResolutionEnvironment>;
export declare const ResolutionCreateCommand: Schema.Struct<{
    schema_version: Schema.Literal<[1]>;
    identifier: Schema.filter<typeof Schema.String>;
    environment: Schema.Literal<["mainnet"]>;
    report_type: Schema.filter<typeof Schema.String>;
    report_version: Schema.filter<typeof Schema.String>;
    community_ref: Schema.optionalWith<Schema.refine<string, Schema.filter<typeof Schema.String>>, {
        exact: true;
    }>;
    idempotency_key: Schema.refine<string, Schema.filter<typeof Schema.String>>;
}>;
export type ResolutionCreateCommand = Schema.Schema.Type<typeof ResolutionCreateCommand>;
/**
 * Immutable original create-request material persisted for re-probe.
 * Excludes the create idempotency key — that is create-session scoped only.
 * Refresh always rebinds to this material; a supplied request must match it
 * byte-for-byte/canonically.
 */
export declare const ResolutionRequestMaterial: Schema.Struct<{
    schema_version: Schema.Literal<[1]>;
    identifier: Schema.filter<typeof Schema.String>;
    environment: Schema.Literal<["mainnet"]>;
    report_type: Schema.filter<typeof Schema.String>;
    report_version: Schema.filter<typeof Schema.String>;
    community_ref: Schema.optionalWith<Schema.refine<string, Schema.filter<typeof Schema.String>>, {
        exact: true;
    }>;
}>;
export type ResolutionRequestMaterial = Schema.Schema.Type<typeof ResolutionRequestMaterial>;
export declare const ResolutionDiagnostics: Schema.Struct<{
    schema_version: Schema.Literal<[1]>;
    searched: Schema.Array$<Schema.Struct<{
        schema_version: Schema.Literal<[1]>;
        network_namespace: Schema.Literal<["eip155", "solana"]>;
        network_reference: Schema.filter<typeof Schema.String>;
    }>>;
    timed_out: Schema.Array$<Schema.Struct<{
        schema_version: Schema.Literal<[1]>;
        network_namespace: Schema.Literal<["eip155", "solana"]>;
        network_reference: Schema.filter<typeof Schema.String>;
    }>>;
    unavailable: Schema.Array$<Schema.Struct<{
        schema_version: Schema.Literal<[1]>;
        network_namespace: Schema.Literal<["eip155", "solana"]>;
        network_reference: Schema.filter<typeof Schema.String>;
    }>>;
}>;
export type ResolutionDiagnostics = Schema.Schema.Type<typeof ResolutionDiagnostics>;
export declare const ResolutionConfirmCommand: Schema.Struct<{
    schema_version: Schema.Literal<[1]>;
    candidate_snapshot_digest: Schema.Struct<{
        algorithm: Schema.Literal<["sha-256"]>;
        domain: Schema.refine<string, typeof Schema.String>;
        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
        digest: Schema.refine<string, typeof Schema.String>;
    }>;
    selected_deployment_ids: Schema.filter<Schema.filter<Schema.Array$<Schema.Struct<{
        algorithm: Schema.Literal<["sha-256"]>;
        domain: Schema.refine<string, typeof Schema.String>;
        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
        digest: Schema.refine<string, typeof Schema.String>;
    }>>>>;
    expected_confirmation_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
    idempotency_key: Schema.refine<string, Schema.filter<typeof Schema.String>>;
}>;
export type ResolutionConfirmCommand = Schema.Schema.Type<typeof ResolutionConfirmCommand>;
export declare const ResolutionRefreshCommand: Schema.Struct<{
    schema_version: Schema.Literal<[1]>;
    expected_confirmation_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
    idempotency_key: Schema.refine<string, Schema.filter<typeof Schema.String>>;
}>;
export type ResolutionRefreshCommand = Schema.Schema.Type<typeof ResolutionRefreshCommand>;
/**
 * Order admission binding. Raw candidate metadata is intentionally absent —
 * clients may not graft deployments, digests, or display fields onto order truth.
 */
export declare const OrderResolutionBinding: Schema.Struct<{
    schema_version: Schema.Literal<[1]>;
    resolution_id: Schema.refine<string, Schema.filter<typeof Schema.String>>;
    candidate_snapshot_digest: Schema.Struct<{
        algorithm: Schema.Literal<["sha-256"]>;
        domain: Schema.refine<string, typeof Schema.String>;
        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
        digest: Schema.refine<string, typeof Schema.String>;
    }>;
    community_ref: Schema.optionalWith<Schema.refine<string, Schema.filter<typeof Schema.String>>, {
        exact: true;
    }>;
}>;
export type OrderResolutionBinding = Schema.Schema.Type<typeof OrderResolutionBinding>;
export declare const CandidateSnapshot: Schema.Struct<{
    schema_version: Schema.Literal<[1]>;
    candidates: Schema.Array$<Schema.refine<{
        readonly identity: {
            readonly symbol?: string | undefined;
            readonly schema_version: 1;
            readonly collection_key?: string | undefined;
            readonly name?: string | undefined;
            readonly image?: string | undefined;
            readonly deployments: readonly ({
                readonly schema_version: 1;
                readonly network: {
                    readonly schema_version: 1;
                    readonly network_namespace: "eip155";
                    readonly network_reference: string;
                };
                readonly address: string;
                readonly normalized_address: string;
                readonly deployment_id: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            } | {
                readonly schema_version: 1;
                readonly network: {
                    readonly schema_version: 1;
                    readonly network_namespace: "solana";
                    readonly network_reference: string;
                };
                readonly address: string;
                readonly normalized_address: string;
                readonly deployment_id: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            })[];
            readonly equivalence_basis: {
                readonly schema_version: 1;
                readonly kind: "single_deployment";
            } | {
                readonly schema_version: 1;
                readonly kind: "registry";
                readonly assertion_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            } | {
                readonly schema_version: 1;
                readonly kind: "operator_ratified";
                readonly assertion_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
                readonly authority_ref: string;
            } | {
                readonly schema_version: 1;
                readonly kind: "protocol_link";
                readonly assertion_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
                readonly protocol: string;
            };
            readonly collection_id: {
                readonly algorithm: "sha-256";
                readonly domain: string;
                readonly major_version: number;
                readonly digest: string;
            };
        };
        readonly provenance: readonly {
            readonly schema_version: 1;
            readonly source: "operator_ratified" | "protocol_link" | "onchain" | "sonar_probe" | "inventory_registry" | "external_metadata";
            readonly source_reference?: string | undefined;
            readonly observed_at: string;
            readonly evidence_digest: {
                readonly algorithm: "sha-256";
                readonly domain: string;
                readonly major_version: number;
                readonly digest: string;
            };
        }[];
        readonly schema_version: 1;
        readonly token_standard: {
            readonly value: string;
            readonly schema_version: 1;
        };
        readonly recognition: "recognized" | "ambiguous" | "unrecognized";
        readonly index_status: "unknown" | "indexed" | "indexing" | "missing" | "unsupported" | "failed";
        readonly report_readiness: "unknown" | "unsupported" | "ready" | "preparation_required" | "blocked";
        readonly metadata_quality: "onchain" | "registry_enriched" | "external_pointer" | "partial" | "unavailable";
        readonly finality_policies: readonly {
            readonly schema_version: 1;
            readonly network: {
                readonly schema_version: 1;
                readonly network_namespace: "eip155";
                readonly network_reference: string;
            } | {
                readonly schema_version: 1;
                readonly network_namespace: "solana";
                readonly network_reference: string;
            };
            readonly finality_policy_version: string;
        }[];
        readonly ranking_reasons: readonly string[];
    }, Schema.Struct<{
        schema_version: Schema.Literal<[1]>;
        identity: Schema.refine<{
            readonly symbol?: string | undefined;
            readonly schema_version: 1;
            readonly collection_key?: string | undefined;
            readonly name?: string | undefined;
            readonly image?: string | undefined;
            readonly deployments: readonly ({
                readonly schema_version: 1;
                readonly network: {
                    readonly schema_version: 1;
                    readonly network_namespace: "eip155";
                    readonly network_reference: string;
                };
                readonly address: string;
                readonly normalized_address: string;
                readonly deployment_id: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            } | {
                readonly schema_version: 1;
                readonly network: {
                    readonly schema_version: 1;
                    readonly network_namespace: "solana";
                    readonly network_reference: string;
                };
                readonly address: string;
                readonly normalized_address: string;
                readonly deployment_id: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            })[];
            readonly equivalence_basis: {
                readonly schema_version: 1;
                readonly kind: "single_deployment";
            } | {
                readonly schema_version: 1;
                readonly kind: "registry";
                readonly assertion_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            } | {
                readonly schema_version: 1;
                readonly kind: "operator_ratified";
                readonly assertion_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
                readonly authority_ref: string;
            } | {
                readonly schema_version: 1;
                readonly kind: "protocol_link";
                readonly assertion_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
                readonly protocol: string;
            };
            readonly collection_id: {
                readonly algorithm: "sha-256";
                readonly domain: string;
                readonly major_version: number;
                readonly digest: string;
            };
        }, Schema.Struct<{
            schema_version: Schema.Literal<[1]>;
            collection_key: Schema.optionalWith<Schema.filter<typeof Schema.String>, {
                exact: true;
            }>;
            name: Schema.optionalWith<Schema.filter<typeof Schema.String>, {
                exact: true;
            }>;
            symbol: Schema.optionalWith<Schema.filter<typeof Schema.String>, {
                exact: true;
            }>;
            image: Schema.optionalWith<Schema.refine<string, typeof Schema.String>, {
                exact: true;
            }>;
            deployments: Schema.filter<Schema.filter<Schema.Array$<Schema.Union<[Schema.filter<Schema.Struct<{
                normalized_address: Schema.refine<string, typeof Schema.String>;
                deployment_id: Schema.filter<Schema.Struct<{
                    algorithm: Schema.Literal<["sha-256"]>;
                    domain: Schema.refine<string, typeof Schema.String>;
                    major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                    digest: Schema.refine<string, typeof Schema.String>;
                }>>;
                schema_version: Schema.Literal<[1]>;
                network: Schema.Struct<{
                    schema_version: Schema.Literal<[1]>;
                    network_namespace: Schema.Literal<["eip155"]>;
                    network_reference: Schema.refine<string, Schema.filter<typeof Schema.String>>;
                }>;
                address: Schema.refine<string, typeof Schema.String>;
            }>>, Schema.filter<Schema.Struct<{
                normalized_address: Schema.refine<string, typeof Schema.String>;
                deployment_id: Schema.filter<Schema.Struct<{
                    algorithm: Schema.Literal<["sha-256"]>;
                    domain: Schema.refine<string, typeof Schema.String>;
                    major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                    digest: Schema.refine<string, typeof Schema.String>;
                }>>;
                schema_version: Schema.Literal<[1]>;
                network: Schema.Struct<{
                    schema_version: Schema.Literal<[1]>;
                    network_namespace: Schema.Literal<["solana"]>;
                    network_reference: Schema.refine<string, typeof Schema.String>;
                }>;
                address: Schema.refine<string, typeof Schema.String>;
            }>>]>>>>;
            equivalence_basis: Schema.Union<[Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                kind: Schema.Literal<["single_deployment"]>;
            }>, Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                kind: Schema.Literal<["registry"]>;
                assertion_digest: Schema.filter<Schema.Struct<{
                    algorithm: Schema.Literal<["sha-256"]>;
                    domain: Schema.refine<string, typeof Schema.String>;
                    major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                    digest: Schema.refine<string, typeof Schema.String>;
                }>>;
            }>, Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                kind: Schema.Literal<["operator_ratified"]>;
                assertion_digest: Schema.filter<Schema.Struct<{
                    algorithm: Schema.Literal<["sha-256"]>;
                    domain: Schema.refine<string, typeof Schema.String>;
                    major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                    digest: Schema.refine<string, typeof Schema.String>;
                }>>;
                authority_ref: Schema.filter<typeof Schema.String>;
            }>, Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                kind: Schema.Literal<["protocol_link"]>;
                assertion_digest: Schema.filter<Schema.Struct<{
                    algorithm: Schema.Literal<["sha-256"]>;
                    domain: Schema.refine<string, typeof Schema.String>;
                    major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                    digest: Schema.refine<string, typeof Schema.String>;
                }>>;
                protocol: Schema.filter<typeof Schema.String>;
            }>]>;
            collection_id: Schema.filter<Schema.Struct<{
                algorithm: Schema.Literal<["sha-256"]>;
                domain: Schema.refine<string, typeof Schema.String>;
                major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                digest: Schema.refine<string, typeof Schema.String>;
            }>>;
        }>>;
        token_standard: Schema.Struct<{
            schema_version: Schema.Literal<[1]>;
            value: Schema.refine<string, typeof Schema.String>;
        }>;
        recognition: Schema.Literal<["recognized", "ambiguous", "unrecognized"]>;
        index_status: Schema.Literal<["indexed", "indexing", "missing", "unsupported", "failed", "unknown"]>;
        report_readiness: Schema.Literal<["ready", "preparation_required", "unsupported", "blocked", "unknown"]>;
        metadata_quality: Schema.Literal<["onchain", "registry_enriched", "external_pointer", "partial", "unavailable"]>;
        provenance: Schema.filter<Schema.Array$<Schema.Struct<{
            schema_version: Schema.Literal<[1]>;
            source: Schema.Literal<["onchain", "sonar_probe", "inventory_registry", "operator_ratified", "protocol_link", "external_metadata"]>;
            source_reference: Schema.optionalWith<Schema.filter<typeof Schema.String>, {
                exact: true;
            }>;
            observed_at: Schema.refine<string, typeof Schema.String>;
            evidence_digest: Schema.filter<Schema.Struct<{
                algorithm: Schema.Literal<["sha-256"]>;
                domain: Schema.refine<string, typeof Schema.String>;
                major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                digest: Schema.refine<string, typeof Schema.String>;
            }>>;
        }>>>;
        finality_policies: Schema.filter<Schema.filter<Schema.Array$<Schema.Struct<{
            schema_version: Schema.Literal<[1]>;
            network: Schema.Union<[Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                network_namespace: Schema.Literal<["eip155"]>;
                network_reference: Schema.refine<string, Schema.filter<typeof Schema.String>>;
            }>, Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                network_namespace: Schema.Literal<["solana"]>;
                network_reference: Schema.refine<string, typeof Schema.String>;
            }>]>;
            finality_policy_version: Schema.refine<string, typeof Schema.String>;
        }>>>>;
        ranking_reasons: Schema.Array$<Schema.filter<typeof Schema.String>>;
    }>>>;
    diagnostics: Schema.Struct<{
        schema_version: Schema.Literal<[1]>;
        searched: Schema.Array$<Schema.Struct<{
            schema_version: Schema.Literal<[1]>;
            network_namespace: Schema.Literal<["eip155", "solana"]>;
            network_reference: Schema.filter<typeof Schema.String>;
        }>>;
        timed_out: Schema.Array$<Schema.Struct<{
            schema_version: Schema.Literal<[1]>;
            network_namespace: Schema.Literal<["eip155", "solana"]>;
            network_reference: Schema.filter<typeof Schema.String>;
        }>>;
        unavailable: Schema.Array$<Schema.Struct<{
            schema_version: Schema.Literal<[1]>;
            network_namespace: Schema.Literal<["eip155", "solana"]>;
            network_reference: Schema.filter<typeof Schema.String>;
        }>>;
    }>;
}>;
export type CandidateSnapshot = Schema.Schema.Type<typeof CandidateSnapshot>;
export declare const ConfirmedResolutionRecord: Schema.Struct<{
    schema_version: Schema.Literal<[1]>;
    resolution_id: Schema.refine<string, Schema.filter<typeof Schema.String>>;
    requester_subject: Schema.refine<string, Schema.filter<typeof Schema.String>>;
    authorization_scope: Schema.Struct<{
        schema_version: Schema.Literal<[1]>;
        subject_id: Schema.refine<string, Schema.filter<typeof Schema.String>>;
        community_ref: Schema.optionalWith<Schema.refine<string, Schema.filter<typeof Schema.String>>, {
            exact: true;
        }>;
        permission: Schema.Literal<["report:create"]>;
    }>;
    /**
     * Complete strict canonical create-request material required to re-probe.
     * Bound mutually with request_digest, authorization_scope, and capability
     * requirements — refresh cannot retarget a different collection identity.
     */
    original_request: Schema.Struct<{
        schema_version: Schema.Literal<[1]>;
        identifier: Schema.filter<typeof Schema.String>;
        environment: Schema.Literal<["mainnet"]>;
        report_type: Schema.filter<typeof Schema.String>;
        report_version: Schema.filter<typeof Schema.String>;
        community_ref: Schema.optionalWith<Schema.refine<string, Schema.filter<typeof Schema.String>>, {
            exact: true;
        }>;
    }>;
    request_digest: Schema.Struct<{
        algorithm: Schema.Literal<["sha-256"]>;
        domain: Schema.refine<string, typeof Schema.String>;
        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
        digest: Schema.refine<string, typeof Schema.String>;
    }>;
    capability_snapshot_version: Schema.Struct<{
        registry_epoch: Schema.refine<string, typeof Schema.String>;
        registry_sequence: Schema.refine<string, Schema.filter<typeof Schema.String>>;
    }>;
    candidate_snapshot: Schema.Struct<{
        schema_version: Schema.Literal<[1]>;
        candidates: Schema.Array$<Schema.refine<{
            readonly identity: {
                readonly symbol?: string | undefined;
                readonly schema_version: 1;
                readonly collection_key?: string | undefined;
                readonly name?: string | undefined;
                readonly image?: string | undefined;
                readonly deployments: readonly ({
                    readonly schema_version: 1;
                    readonly network: {
                        readonly schema_version: 1;
                        readonly network_namespace: "eip155";
                        readonly network_reference: string;
                    };
                    readonly address: string;
                    readonly normalized_address: string;
                    readonly deployment_id: {
                        readonly algorithm: "sha-256";
                        readonly domain: string;
                        readonly major_version: number;
                        readonly digest: string;
                    };
                } | {
                    readonly schema_version: 1;
                    readonly network: {
                        readonly schema_version: 1;
                        readonly network_namespace: "solana";
                        readonly network_reference: string;
                    };
                    readonly address: string;
                    readonly normalized_address: string;
                    readonly deployment_id: {
                        readonly algorithm: "sha-256";
                        readonly domain: string;
                        readonly major_version: number;
                        readonly digest: string;
                    };
                })[];
                readonly equivalence_basis: {
                    readonly schema_version: 1;
                    readonly kind: "single_deployment";
                } | {
                    readonly schema_version: 1;
                    readonly kind: "registry";
                    readonly assertion_digest: {
                        readonly algorithm: "sha-256";
                        readonly domain: string;
                        readonly major_version: number;
                        readonly digest: string;
                    };
                } | {
                    readonly schema_version: 1;
                    readonly kind: "operator_ratified";
                    readonly assertion_digest: {
                        readonly algorithm: "sha-256";
                        readonly domain: string;
                        readonly major_version: number;
                        readonly digest: string;
                    };
                    readonly authority_ref: string;
                } | {
                    readonly schema_version: 1;
                    readonly kind: "protocol_link";
                    readonly assertion_digest: {
                        readonly algorithm: "sha-256";
                        readonly domain: string;
                        readonly major_version: number;
                        readonly digest: string;
                    };
                    readonly protocol: string;
                };
                readonly collection_id: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            };
            readonly provenance: readonly {
                readonly schema_version: 1;
                readonly source: "operator_ratified" | "protocol_link" | "onchain" | "sonar_probe" | "inventory_registry" | "external_metadata";
                readonly source_reference?: string | undefined;
                readonly observed_at: string;
                readonly evidence_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            }[];
            readonly schema_version: 1;
            readonly token_standard: {
                readonly value: string;
                readonly schema_version: 1;
            };
            readonly recognition: "recognized" | "ambiguous" | "unrecognized";
            readonly index_status: "unknown" | "indexed" | "indexing" | "missing" | "unsupported" | "failed";
            readonly report_readiness: "unknown" | "unsupported" | "ready" | "preparation_required" | "blocked";
            readonly metadata_quality: "onchain" | "registry_enriched" | "external_pointer" | "partial" | "unavailable";
            readonly finality_policies: readonly {
                readonly schema_version: 1;
                readonly network: {
                    readonly schema_version: 1;
                    readonly network_namespace: "eip155";
                    readonly network_reference: string;
                } | {
                    readonly schema_version: 1;
                    readonly network_namespace: "solana";
                    readonly network_reference: string;
                };
                readonly finality_policy_version: string;
            }[];
            readonly ranking_reasons: readonly string[];
        }, Schema.Struct<{
            schema_version: Schema.Literal<[1]>;
            identity: Schema.refine<{
                readonly symbol?: string | undefined;
                readonly schema_version: 1;
                readonly collection_key?: string | undefined;
                readonly name?: string | undefined;
                readonly image?: string | undefined;
                readonly deployments: readonly ({
                    readonly schema_version: 1;
                    readonly network: {
                        readonly schema_version: 1;
                        readonly network_namespace: "eip155";
                        readonly network_reference: string;
                    };
                    readonly address: string;
                    readonly normalized_address: string;
                    readonly deployment_id: {
                        readonly algorithm: "sha-256";
                        readonly domain: string;
                        readonly major_version: number;
                        readonly digest: string;
                    };
                } | {
                    readonly schema_version: 1;
                    readonly network: {
                        readonly schema_version: 1;
                        readonly network_namespace: "solana";
                        readonly network_reference: string;
                    };
                    readonly address: string;
                    readonly normalized_address: string;
                    readonly deployment_id: {
                        readonly algorithm: "sha-256";
                        readonly domain: string;
                        readonly major_version: number;
                        readonly digest: string;
                    };
                })[];
                readonly equivalence_basis: {
                    readonly schema_version: 1;
                    readonly kind: "single_deployment";
                } | {
                    readonly schema_version: 1;
                    readonly kind: "registry";
                    readonly assertion_digest: {
                        readonly algorithm: "sha-256";
                        readonly domain: string;
                        readonly major_version: number;
                        readonly digest: string;
                    };
                } | {
                    readonly schema_version: 1;
                    readonly kind: "operator_ratified";
                    readonly assertion_digest: {
                        readonly algorithm: "sha-256";
                        readonly domain: string;
                        readonly major_version: number;
                        readonly digest: string;
                    };
                    readonly authority_ref: string;
                } | {
                    readonly schema_version: 1;
                    readonly kind: "protocol_link";
                    readonly assertion_digest: {
                        readonly algorithm: "sha-256";
                        readonly domain: string;
                        readonly major_version: number;
                        readonly digest: string;
                    };
                    readonly protocol: string;
                };
                readonly collection_id: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            }, Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                collection_key: Schema.optionalWith<Schema.filter<typeof Schema.String>, {
                    exact: true;
                }>;
                name: Schema.optionalWith<Schema.filter<typeof Schema.String>, {
                    exact: true;
                }>;
                symbol: Schema.optionalWith<Schema.filter<typeof Schema.String>, {
                    exact: true;
                }>;
                image: Schema.optionalWith<Schema.refine<string, typeof Schema.String>, {
                    exact: true;
                }>;
                deployments: Schema.filter<Schema.filter<Schema.Array$<Schema.Union<[Schema.filter<Schema.Struct<{
                    normalized_address: Schema.refine<string, typeof Schema.String>;
                    deployment_id: Schema.filter<Schema.Struct<{
                        algorithm: Schema.Literal<["sha-256"]>;
                        domain: Schema.refine<string, typeof Schema.String>;
                        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                        digest: Schema.refine<string, typeof Schema.String>;
                    }>>;
                    schema_version: Schema.Literal<[1]>;
                    network: Schema.Struct<{
                        schema_version: Schema.Literal<[1]>;
                        network_namespace: Schema.Literal<["eip155"]>;
                        network_reference: Schema.refine<string, Schema.filter<typeof Schema.String>>;
                    }>;
                    address: Schema.refine<string, typeof Schema.String>;
                }>>, Schema.filter<Schema.Struct<{
                    normalized_address: Schema.refine<string, typeof Schema.String>;
                    deployment_id: Schema.filter<Schema.Struct<{
                        algorithm: Schema.Literal<["sha-256"]>;
                        domain: Schema.refine<string, typeof Schema.String>;
                        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                        digest: Schema.refine<string, typeof Schema.String>;
                    }>>;
                    schema_version: Schema.Literal<[1]>;
                    network: Schema.Struct<{
                        schema_version: Schema.Literal<[1]>;
                        network_namespace: Schema.Literal<["solana"]>;
                        network_reference: Schema.refine<string, typeof Schema.String>;
                    }>;
                    address: Schema.refine<string, typeof Schema.String>;
                }>>]>>>>;
                equivalence_basis: Schema.Union<[Schema.Struct<{
                    schema_version: Schema.Literal<[1]>;
                    kind: Schema.Literal<["single_deployment"]>;
                }>, Schema.Struct<{
                    schema_version: Schema.Literal<[1]>;
                    kind: Schema.Literal<["registry"]>;
                    assertion_digest: Schema.filter<Schema.Struct<{
                        algorithm: Schema.Literal<["sha-256"]>;
                        domain: Schema.refine<string, typeof Schema.String>;
                        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                        digest: Schema.refine<string, typeof Schema.String>;
                    }>>;
                }>, Schema.Struct<{
                    schema_version: Schema.Literal<[1]>;
                    kind: Schema.Literal<["operator_ratified"]>;
                    assertion_digest: Schema.filter<Schema.Struct<{
                        algorithm: Schema.Literal<["sha-256"]>;
                        domain: Schema.refine<string, typeof Schema.String>;
                        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                        digest: Schema.refine<string, typeof Schema.String>;
                    }>>;
                    authority_ref: Schema.filter<typeof Schema.String>;
                }>, Schema.Struct<{
                    schema_version: Schema.Literal<[1]>;
                    kind: Schema.Literal<["protocol_link"]>;
                    assertion_digest: Schema.filter<Schema.Struct<{
                        algorithm: Schema.Literal<["sha-256"]>;
                        domain: Schema.refine<string, typeof Schema.String>;
                        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                        digest: Schema.refine<string, typeof Schema.String>;
                    }>>;
                    protocol: Schema.filter<typeof Schema.String>;
                }>]>;
                collection_id: Schema.filter<Schema.Struct<{
                    algorithm: Schema.Literal<["sha-256"]>;
                    domain: Schema.refine<string, typeof Schema.String>;
                    major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                    digest: Schema.refine<string, typeof Schema.String>;
                }>>;
            }>>;
            token_standard: Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                value: Schema.refine<string, typeof Schema.String>;
            }>;
            recognition: Schema.Literal<["recognized", "ambiguous", "unrecognized"]>;
            index_status: Schema.Literal<["indexed", "indexing", "missing", "unsupported", "failed", "unknown"]>;
            report_readiness: Schema.Literal<["ready", "preparation_required", "unsupported", "blocked", "unknown"]>;
            metadata_quality: Schema.Literal<["onchain", "registry_enriched", "external_pointer", "partial", "unavailable"]>;
            provenance: Schema.filter<Schema.Array$<Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                source: Schema.Literal<["onchain", "sonar_probe", "inventory_registry", "operator_ratified", "protocol_link", "external_metadata"]>;
                source_reference: Schema.optionalWith<Schema.filter<typeof Schema.String>, {
                    exact: true;
                }>;
                observed_at: Schema.refine<string, typeof Schema.String>;
                evidence_digest: Schema.filter<Schema.Struct<{
                    algorithm: Schema.Literal<["sha-256"]>;
                    domain: Schema.refine<string, typeof Schema.String>;
                    major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                    digest: Schema.refine<string, typeof Schema.String>;
                }>>;
            }>>>;
            finality_policies: Schema.filter<Schema.filter<Schema.Array$<Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                network: Schema.Union<[Schema.Struct<{
                    schema_version: Schema.Literal<[1]>;
                    network_namespace: Schema.Literal<["eip155"]>;
                    network_reference: Schema.refine<string, Schema.filter<typeof Schema.String>>;
                }>, Schema.Struct<{
                    schema_version: Schema.Literal<[1]>;
                    network_namespace: Schema.Literal<["solana"]>;
                    network_reference: Schema.refine<string, typeof Schema.String>;
                }>]>;
                finality_policy_version: Schema.refine<string, typeof Schema.String>;
            }>>>>;
            ranking_reasons: Schema.Array$<Schema.filter<typeof Schema.String>>;
        }>>>;
        diagnostics: Schema.Struct<{
            schema_version: Schema.Literal<[1]>;
            searched: Schema.Array$<Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                network_namespace: Schema.Literal<["eip155", "solana"]>;
                network_reference: Schema.filter<typeof Schema.String>;
            }>>;
            timed_out: Schema.Array$<Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                network_namespace: Schema.Literal<["eip155", "solana"]>;
                network_reference: Schema.filter<typeof Schema.String>;
            }>>;
            unavailable: Schema.Array$<Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                network_namespace: Schema.Literal<["eip155", "solana"]>;
                network_reference: Schema.filter<typeof Schema.String>;
            }>>;
        }>;
    }>;
    candidate_snapshot_digest: Schema.Struct<{
        algorithm: Schema.Literal<["sha-256"]>;
        domain: Schema.refine<string, typeof Schema.String>;
        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
        digest: Schema.refine<string, typeof Schema.String>;
    }>;
    selected_deployment_ids: Schema.optionalWith<Schema.filter<Schema.filter<Schema.Array$<Schema.Struct<{
        algorithm: Schema.Literal<["sha-256"]>;
        domain: Schema.refine<string, typeof Schema.String>;
        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
        digest: Schema.refine<string, typeof Schema.String>;
    }>>>>, {
        exact: true;
    }>;
    selected_collection_id: Schema.optionalWith<Schema.Struct<{
        algorithm: Schema.Literal<["sha-256"]>;
        domain: Schema.refine<string, typeof Schema.String>;
        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
        digest: Schema.refine<string, typeof Schema.String>;
    }>, {
        exact: true;
    }>;
    confirmation_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
    confirmed_at: Schema.optionalWith<Schema.refine<string, typeof Schema.String>, {
        exact: true;
    }>;
    expires_at: Schema.refine<string, typeof Schema.String>;
    created_at: Schema.refine<string, typeof Schema.String>;
    updated_at: Schema.refine<string, typeof Schema.String>;
}>;
export type ConfirmedResolutionRecord = Schema.Schema.Type<typeof ConfirmedResolutionRecord>;
export declare const ResolutionPublicProjection: Schema.Struct<{
    schema_version: Schema.Literal<[1]>;
    resolution_id: Schema.refine<string, Schema.filter<typeof Schema.String>>;
    candidate_snapshot_digest: Schema.Struct<{
        algorithm: Schema.Literal<["sha-256"]>;
        domain: Schema.refine<string, typeof Schema.String>;
        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
        digest: Schema.refine<string, typeof Schema.String>;
    }>;
    capability_snapshot_version: Schema.Struct<{
        registry_epoch: Schema.refine<string, typeof Schema.String>;
        registry_sequence: Schema.refine<string, Schema.filter<typeof Schema.String>>;
    }>;
    candidates: Schema.Array$<Schema.refine<{
        readonly identity: {
            readonly symbol?: string | undefined;
            readonly schema_version: 1;
            readonly collection_key?: string | undefined;
            readonly name?: string | undefined;
            readonly image?: string | undefined;
            readonly deployments: readonly ({
                readonly schema_version: 1;
                readonly network: {
                    readonly schema_version: 1;
                    readonly network_namespace: "eip155";
                    readonly network_reference: string;
                };
                readonly address: string;
                readonly normalized_address: string;
                readonly deployment_id: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            } | {
                readonly schema_version: 1;
                readonly network: {
                    readonly schema_version: 1;
                    readonly network_namespace: "solana";
                    readonly network_reference: string;
                };
                readonly address: string;
                readonly normalized_address: string;
                readonly deployment_id: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            })[];
            readonly equivalence_basis: {
                readonly schema_version: 1;
                readonly kind: "single_deployment";
            } | {
                readonly schema_version: 1;
                readonly kind: "registry";
                readonly assertion_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            } | {
                readonly schema_version: 1;
                readonly kind: "operator_ratified";
                readonly assertion_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
                readonly authority_ref: string;
            } | {
                readonly schema_version: 1;
                readonly kind: "protocol_link";
                readonly assertion_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
                readonly protocol: string;
            };
            readonly collection_id: {
                readonly algorithm: "sha-256";
                readonly domain: string;
                readonly major_version: number;
                readonly digest: string;
            };
        };
        readonly provenance: readonly {
            readonly schema_version: 1;
            readonly source: "operator_ratified" | "protocol_link" | "onchain" | "sonar_probe" | "inventory_registry" | "external_metadata";
            readonly source_reference?: string | undefined;
            readonly observed_at: string;
            readonly evidence_digest: {
                readonly algorithm: "sha-256";
                readonly domain: string;
                readonly major_version: number;
                readonly digest: string;
            };
        }[];
        readonly schema_version: 1;
        readonly token_standard: {
            readonly value: string;
            readonly schema_version: 1;
        };
        readonly recognition: "recognized" | "ambiguous" | "unrecognized";
        readonly index_status: "unknown" | "indexed" | "indexing" | "missing" | "unsupported" | "failed";
        readonly report_readiness: "unknown" | "unsupported" | "ready" | "preparation_required" | "blocked";
        readonly metadata_quality: "onchain" | "registry_enriched" | "external_pointer" | "partial" | "unavailable";
        readonly finality_policies: readonly {
            readonly schema_version: 1;
            readonly network: {
                readonly schema_version: 1;
                readonly network_namespace: "eip155";
                readonly network_reference: string;
            } | {
                readonly schema_version: 1;
                readonly network_namespace: "solana";
                readonly network_reference: string;
            };
            readonly finality_policy_version: string;
        }[];
        readonly ranking_reasons: readonly string[];
    }, Schema.Struct<{
        schema_version: Schema.Literal<[1]>;
        identity: Schema.refine<{
            readonly symbol?: string | undefined;
            readonly schema_version: 1;
            readonly collection_key?: string | undefined;
            readonly name?: string | undefined;
            readonly image?: string | undefined;
            readonly deployments: readonly ({
                readonly schema_version: 1;
                readonly network: {
                    readonly schema_version: 1;
                    readonly network_namespace: "eip155";
                    readonly network_reference: string;
                };
                readonly address: string;
                readonly normalized_address: string;
                readonly deployment_id: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            } | {
                readonly schema_version: 1;
                readonly network: {
                    readonly schema_version: 1;
                    readonly network_namespace: "solana";
                    readonly network_reference: string;
                };
                readonly address: string;
                readonly normalized_address: string;
                readonly deployment_id: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            })[];
            readonly equivalence_basis: {
                readonly schema_version: 1;
                readonly kind: "single_deployment";
            } | {
                readonly schema_version: 1;
                readonly kind: "registry";
                readonly assertion_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            } | {
                readonly schema_version: 1;
                readonly kind: "operator_ratified";
                readonly assertion_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
                readonly authority_ref: string;
            } | {
                readonly schema_version: 1;
                readonly kind: "protocol_link";
                readonly assertion_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
                readonly protocol: string;
            };
            readonly collection_id: {
                readonly algorithm: "sha-256";
                readonly domain: string;
                readonly major_version: number;
                readonly digest: string;
            };
        }, Schema.Struct<{
            schema_version: Schema.Literal<[1]>;
            collection_key: Schema.optionalWith<Schema.filter<typeof Schema.String>, {
                exact: true;
            }>;
            name: Schema.optionalWith<Schema.filter<typeof Schema.String>, {
                exact: true;
            }>;
            symbol: Schema.optionalWith<Schema.filter<typeof Schema.String>, {
                exact: true;
            }>;
            image: Schema.optionalWith<Schema.refine<string, typeof Schema.String>, {
                exact: true;
            }>;
            deployments: Schema.filter<Schema.filter<Schema.Array$<Schema.Union<[Schema.filter<Schema.Struct<{
                normalized_address: Schema.refine<string, typeof Schema.String>;
                deployment_id: Schema.filter<Schema.Struct<{
                    algorithm: Schema.Literal<["sha-256"]>;
                    domain: Schema.refine<string, typeof Schema.String>;
                    major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                    digest: Schema.refine<string, typeof Schema.String>;
                }>>;
                schema_version: Schema.Literal<[1]>;
                network: Schema.Struct<{
                    schema_version: Schema.Literal<[1]>;
                    network_namespace: Schema.Literal<["eip155"]>;
                    network_reference: Schema.refine<string, Schema.filter<typeof Schema.String>>;
                }>;
                address: Schema.refine<string, typeof Schema.String>;
            }>>, Schema.filter<Schema.Struct<{
                normalized_address: Schema.refine<string, typeof Schema.String>;
                deployment_id: Schema.filter<Schema.Struct<{
                    algorithm: Schema.Literal<["sha-256"]>;
                    domain: Schema.refine<string, typeof Schema.String>;
                    major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                    digest: Schema.refine<string, typeof Schema.String>;
                }>>;
                schema_version: Schema.Literal<[1]>;
                network: Schema.Struct<{
                    schema_version: Schema.Literal<[1]>;
                    network_namespace: Schema.Literal<["solana"]>;
                    network_reference: Schema.refine<string, typeof Schema.String>;
                }>;
                address: Schema.refine<string, typeof Schema.String>;
            }>>]>>>>;
            equivalence_basis: Schema.Union<[Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                kind: Schema.Literal<["single_deployment"]>;
            }>, Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                kind: Schema.Literal<["registry"]>;
                assertion_digest: Schema.filter<Schema.Struct<{
                    algorithm: Schema.Literal<["sha-256"]>;
                    domain: Schema.refine<string, typeof Schema.String>;
                    major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                    digest: Schema.refine<string, typeof Schema.String>;
                }>>;
            }>, Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                kind: Schema.Literal<["operator_ratified"]>;
                assertion_digest: Schema.filter<Schema.Struct<{
                    algorithm: Schema.Literal<["sha-256"]>;
                    domain: Schema.refine<string, typeof Schema.String>;
                    major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                    digest: Schema.refine<string, typeof Schema.String>;
                }>>;
                authority_ref: Schema.filter<typeof Schema.String>;
            }>, Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                kind: Schema.Literal<["protocol_link"]>;
                assertion_digest: Schema.filter<Schema.Struct<{
                    algorithm: Schema.Literal<["sha-256"]>;
                    domain: Schema.refine<string, typeof Schema.String>;
                    major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                    digest: Schema.refine<string, typeof Schema.String>;
                }>>;
                protocol: Schema.filter<typeof Schema.String>;
            }>]>;
            collection_id: Schema.filter<Schema.Struct<{
                algorithm: Schema.Literal<["sha-256"]>;
                domain: Schema.refine<string, typeof Schema.String>;
                major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                digest: Schema.refine<string, typeof Schema.String>;
            }>>;
        }>>;
        token_standard: Schema.Struct<{
            schema_version: Schema.Literal<[1]>;
            value: Schema.refine<string, typeof Schema.String>;
        }>;
        recognition: Schema.Literal<["recognized", "ambiguous", "unrecognized"]>;
        index_status: Schema.Literal<["indexed", "indexing", "missing", "unsupported", "failed", "unknown"]>;
        report_readiness: Schema.Literal<["ready", "preparation_required", "unsupported", "blocked", "unknown"]>;
        metadata_quality: Schema.Literal<["onchain", "registry_enriched", "external_pointer", "partial", "unavailable"]>;
        provenance: Schema.filter<Schema.Array$<Schema.Struct<{
            schema_version: Schema.Literal<[1]>;
            source: Schema.Literal<["onchain", "sonar_probe", "inventory_registry", "operator_ratified", "protocol_link", "external_metadata"]>;
            source_reference: Schema.optionalWith<Schema.filter<typeof Schema.String>, {
                exact: true;
            }>;
            observed_at: Schema.refine<string, typeof Schema.String>;
            evidence_digest: Schema.filter<Schema.Struct<{
                algorithm: Schema.Literal<["sha-256"]>;
                domain: Schema.refine<string, typeof Schema.String>;
                major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
                digest: Schema.refine<string, typeof Schema.String>;
            }>>;
        }>>>;
        finality_policies: Schema.filter<Schema.filter<Schema.Array$<Schema.Struct<{
            schema_version: Schema.Literal<[1]>;
            network: Schema.Union<[Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                network_namespace: Schema.Literal<["eip155"]>;
                network_reference: Schema.refine<string, Schema.filter<typeof Schema.String>>;
            }>, Schema.Struct<{
                schema_version: Schema.Literal<[1]>;
                network_namespace: Schema.Literal<["solana"]>;
                network_reference: Schema.refine<string, typeof Schema.String>;
            }>]>;
            finality_policy_version: Schema.refine<string, typeof Schema.String>;
        }>>>>;
        ranking_reasons: Schema.Array$<Schema.filter<typeof Schema.String>>;
    }>>>;
    diagnostics: Schema.Struct<{
        schema_version: Schema.Literal<[1]>;
        searched: Schema.Array$<Schema.Struct<{
            schema_version: Schema.Literal<[1]>;
            network_namespace: Schema.Literal<["eip155", "solana"]>;
            network_reference: Schema.filter<typeof Schema.String>;
        }>>;
        timed_out: Schema.Array$<Schema.Struct<{
            schema_version: Schema.Literal<[1]>;
            network_namespace: Schema.Literal<["eip155", "solana"]>;
            network_reference: Schema.filter<typeof Schema.String>;
        }>>;
        unavailable: Schema.Array$<Schema.Struct<{
            schema_version: Schema.Literal<[1]>;
            network_namespace: Schema.Literal<["eip155", "solana"]>;
            network_reference: Schema.filter<typeof Schema.String>;
        }>>;
    }>;
    confirmation_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
    selected_deployment_ids: Schema.optionalWith<Schema.filter<Schema.filter<Schema.Array$<Schema.Struct<{
        algorithm: Schema.Literal<["sha-256"]>;
        domain: Schema.refine<string, typeof Schema.String>;
        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
        digest: Schema.refine<string, typeof Schema.String>;
    }>>>>, {
        exact: true;
    }>;
    selected_collection_id: Schema.optionalWith<Schema.Struct<{
        algorithm: Schema.Literal<["sha-256"]>;
        domain: Schema.refine<string, typeof Schema.String>;
        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
        digest: Schema.refine<string, typeof Schema.String>;
    }>, {
        exact: true;
    }>;
    confirmed_at: Schema.optionalWith<Schema.refine<string, typeof Schema.String>, {
        exact: true;
    }>;
    expires_at: Schema.refine<string, typeof Schema.String>;
    selection_stale: Schema.optionalWith<Schema.Literal<[true]>, {
        exact: true;
    }>;
}>;
export type ResolutionPublicProjection = Schema.Schema.Type<typeof ResolutionPublicProjection>;
export declare const CapabilityHealthState: Schema.Literal<["available", "degraded", "disabled"]>;
export type CapabilityHealthState = Schema.Schema.Type<typeof CapabilityHealthState>;
export declare const CapabilityOperation: Schema.Literal<["recognize", "prepare", "read_evidence"]>;
export type CapabilityOperation = Schema.Schema.Type<typeof CapabilityOperation>;
/**
 * Exact local capability view consulted at admission. Every field participates
 * in compatibility; UI omission never authorizes ignoring a field.
 * Views are a strict unique set keyed by (deployment_id, operation).
 */
export declare const LocalCapabilityDeploymentView: Schema.Struct<{
    schema_version: Schema.Literal<[1]>;
    deployment_id: Schema.Struct<{
        algorithm: Schema.Literal<["sha-256"]>;
        domain: Schema.refine<string, typeof Schema.String>;
        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
        digest: Schema.refine<string, typeof Schema.String>;
    }>;
    network_namespace: Schema.Literal<["eip155", "solana"]>;
    network_reference: Schema.filter<typeof Schema.String>;
    normalized_address: Schema.filter<typeof Schema.String>;
    operation: Schema.Literal<["recognize", "prepare", "read_evidence"]>;
    health: Schema.Literal<["available", "degraded", "disabled"]>;
    supported_standards: Schema.Array$<Schema.filter<typeof Schema.String>>;
    finality_policy_version: Schema.filter<typeof Schema.String>;
    equivalence_revoked: typeof Schema.Boolean;
    authorization_valid: typeof Schema.Boolean;
    identity_digest: Schema.Struct<{
        algorithm: Schema.Literal<["sha-256"]>;
        domain: Schema.refine<string, typeof Schema.String>;
        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
        digest: Schema.refine<string, typeof Schema.String>;
    }>;
}>;
export type LocalCapabilityDeploymentView = Schema.Schema.Type<typeof LocalCapabilityDeploymentView>;
export declare const capabilityViewSetKey: (view: LocalCapabilityDeploymentView) => string;
export declare const LocalCapabilitySnapshot: Schema.Struct<{
    schema_version: Schema.Literal<[1]>;
    registry_version: Schema.Struct<{
        registry_epoch: Schema.refine<string, typeof Schema.String>;
        registry_sequence: Schema.refine<string, Schema.filter<typeof Schema.String>>;
    }>;
    views: Schema.Array$<Schema.Struct<{
        schema_version: Schema.Literal<[1]>;
        deployment_id: Schema.Struct<{
            algorithm: Schema.Literal<["sha-256"]>;
            domain: Schema.refine<string, typeof Schema.String>;
            major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
            digest: Schema.refine<string, typeof Schema.String>;
        }>;
        network_namespace: Schema.Literal<["eip155", "solana"]>;
        network_reference: Schema.filter<typeof Schema.String>;
        normalized_address: Schema.filter<typeof Schema.String>;
        operation: Schema.Literal<["recognize", "prepare", "read_evidence"]>;
        health: Schema.Literal<["available", "degraded", "disabled"]>;
        supported_standards: Schema.Array$<Schema.filter<typeof Schema.String>>;
        finality_policy_version: Schema.filter<typeof Schema.String>;
        equivalence_revoked: typeof Schema.Boolean;
        authorization_valid: typeof Schema.Boolean;
        identity_digest: Schema.Struct<{
            algorithm: Schema.Literal<["sha-256"]>;
            domain: Schema.refine<string, typeof Schema.String>;
            major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
            digest: Schema.refine<string, typeof Schema.String>;
        }>;
    }>>;
    receipt_age_ms: Schema.filter<Schema.filter<typeof Schema.Number>>;
    staleness_ceiling_ms: Schema.filter<Schema.filter<typeof Schema.Number>>;
}>;
export type LocalCapabilitySnapshot = Schema.Schema.Type<typeof LocalCapabilitySnapshot>;
export declare const AdmissionDecision: Schema.Struct<{
    schema_version: Schema.Literal<[1]>;
    resolution_id: Schema.refine<string, Schema.filter<typeof Schema.String>>;
    candidate_snapshot_digest: Schema.Struct<{
        algorithm: Schema.Literal<["sha-256"]>;
        domain: Schema.refine<string, typeof Schema.String>;
        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
        digest: Schema.refine<string, typeof Schema.String>;
    }>;
    selected_deployment_ids: Schema.filter<Schema.filter<Schema.Array$<Schema.Struct<{
        algorithm: Schema.Literal<["sha-256"]>;
        domain: Schema.refine<string, typeof Schema.String>;
        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
        digest: Schema.refine<string, typeof Schema.String>;
    }>>>>;
    selected_collection_id: Schema.optionalWith<Schema.Struct<{
        algorithm: Schema.Literal<["sha-256"]>;
        domain: Schema.refine<string, typeof Schema.String>;
        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
        digest: Schema.refine<string, typeof Schema.String>;
    }>, {
        exact: true;
    }>;
    admitted_registry_version: Schema.Struct<{
        registry_epoch: Schema.refine<string, typeof Schema.String>;
        registry_sequence: Schema.refine<string, Schema.filter<typeof Schema.String>>;
    }>;
    compatibility_digest: Schema.Struct<{
        algorithm: Schema.Literal<["sha-256"]>;
        domain: Schema.refine<string, typeof Schema.String>;
        major_version: Schema.filter<Schema.filter<typeof Schema.Number>>;
        digest: Schema.refine<string, typeof Schema.String>;
    }>;
    decision: Schema.Literal<["admit", "selection_stale", "capability_view_stale", "refuse"]>;
}>;
export type AdmissionDecision = Schema.Schema.Type<typeof AdmissionDecision>;
export declare const decodeResolutionCreateCommand: (u: unknown, overrideOptions?: ParseOptions) => Effect.Effect<{
    readonly idempotency_key: string;
    readonly identifier: string;
    readonly schema_version: 1;
    readonly community_ref?: string | undefined;
    readonly environment: "mainnet";
    readonly report_type: string;
    readonly report_version: string;
}, import("effect/ParseResult").ParseError, never>;
export declare const decodeResolutionConfirmCommand: (u: unknown, overrideOptions?: ParseOptions) => Effect.Effect<{
    readonly idempotency_key: string;
    readonly expected_confirmation_version: number;
    readonly schema_version: 1;
    readonly candidate_snapshot_digest: {
        readonly algorithm: "sha-256";
        readonly domain: string;
        readonly major_version: number;
        readonly digest: string;
    };
    readonly selected_deployment_ids: readonly {
        readonly algorithm: "sha-256";
        readonly domain: string;
        readonly major_version: number;
        readonly digest: string;
    }[];
}, import("effect/ParseResult").ParseError, never>;
export declare const decodeResolutionRefreshCommand: (u: unknown, overrideOptions?: ParseOptions) => Effect.Effect<{
    readonly idempotency_key: string;
    readonly expected_confirmation_version: number;
    readonly schema_version: 1;
}, import("effect/ParseResult").ParseError, never>;
export declare const decodeResolutionRequestMaterial: (u: unknown, overrideOptions?: ParseOptions) => Effect.Effect<{
    readonly identifier: string;
    readonly schema_version: 1;
    readonly community_ref?: string | undefined;
    readonly environment: "mainnet";
    readonly report_type: string;
    readonly report_version: string;
}, import("effect/ParseResult").ParseError, never>;
export declare const decodeOrderResolutionBinding: (u: unknown, overrideOptions?: ParseOptions) => Effect.Effect<{
    readonly resolution_id: string;
    readonly schema_version: 1;
    readonly community_ref?: string | undefined;
    readonly candidate_snapshot_digest: {
        readonly algorithm: "sha-256";
        readonly domain: string;
        readonly major_version: number;
        readonly digest: string;
    };
}, import("effect/ParseResult").ParseError, never>;
export declare const decodeCandidateSnapshot: (input: unknown) => Effect.Effect<{
    candidates: {
        readonly identity: {
            readonly symbol?: string | undefined;
            readonly schema_version: 1;
            readonly collection_key?: string | undefined;
            readonly name?: string | undefined;
            readonly image?: string | undefined;
            readonly deployments: readonly ({
                readonly schema_version: 1;
                readonly network: {
                    readonly schema_version: 1;
                    readonly network_namespace: "eip155";
                    readonly network_reference: string;
                };
                readonly address: string;
                readonly normalized_address: string;
                readonly deployment_id: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            } | {
                readonly schema_version: 1;
                readonly network: {
                    readonly schema_version: 1;
                    readonly network_namespace: "solana";
                    readonly network_reference: string;
                };
                readonly address: string;
                readonly normalized_address: string;
                readonly deployment_id: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            })[];
            readonly equivalence_basis: {
                readonly schema_version: 1;
                readonly kind: "single_deployment";
            } | {
                readonly schema_version: 1;
                readonly kind: "registry";
                readonly assertion_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            } | {
                readonly schema_version: 1;
                readonly kind: "operator_ratified";
                readonly assertion_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
                readonly authority_ref: string;
            } | {
                readonly schema_version: 1;
                readonly kind: "protocol_link";
                readonly assertion_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
                readonly protocol: string;
            };
            readonly collection_id: {
                readonly algorithm: "sha-256";
                readonly domain: string;
                readonly major_version: number;
                readonly digest: string;
            };
        };
        readonly provenance: readonly {
            readonly schema_version: 1;
            readonly source: "operator_ratified" | "protocol_link" | "onchain" | "sonar_probe" | "inventory_registry" | "external_metadata";
            readonly source_reference?: string | undefined;
            readonly observed_at: string;
            readonly evidence_digest: {
                readonly algorithm: "sha-256";
                readonly domain: string;
                readonly major_version: number;
                readonly digest: string;
            };
        }[];
        readonly schema_version: 1;
        readonly token_standard: {
            readonly value: string;
            readonly schema_version: 1;
        };
        readonly recognition: "recognized" | "ambiguous" | "unrecognized";
        readonly index_status: "unknown" | "indexed" | "indexing" | "missing" | "unsupported" | "failed";
        readonly report_readiness: "unknown" | "unsupported" | "ready" | "preparation_required" | "blocked";
        readonly metadata_quality: "onchain" | "registry_enriched" | "external_pointer" | "partial" | "unavailable";
        readonly finality_policies: readonly {
            readonly schema_version: 1;
            readonly network: {
                readonly schema_version: 1;
                readonly network_namespace: "eip155";
                readonly network_reference: string;
            } | {
                readonly schema_version: 1;
                readonly network_namespace: "solana";
                readonly network_reference: string;
            };
            readonly finality_policy_version: string;
        }[];
        readonly ranking_reasons: readonly string[];
    }[];
    schema_version: 1;
    diagnostics: {
        readonly schema_version: 1;
        readonly searched: readonly {
            readonly schema_version: 1;
            readonly network_namespace: "eip155" | "solana";
            readonly network_reference: string;
        }[];
        readonly timed_out: readonly {
            readonly schema_version: 1;
            readonly network_namespace: "eip155" | "solana";
            readonly network_reference: string;
        }[];
        readonly unavailable: readonly {
            readonly schema_version: 1;
            readonly network_namespace: "eip155" | "solana";
            readonly network_reference: string;
        }[];
    };
}, import("effect/ParseResult").ParseError | import("@freeside/collection-protocol").CanonicalEncodingError | import("@freeside/collection-protocol").DigestComputationError | import("@freeside/collection-protocol").ContractIntegrityError, never>;
export declare const decodeConfirmedResolutionRecord: (input: unknown) => Effect.Effect<{
    candidate_snapshot: {
        candidates: {
            readonly identity: {
                readonly symbol?: string | undefined;
                readonly schema_version: 1;
                readonly collection_key?: string | undefined;
                readonly name?: string | undefined;
                readonly image?: string | undefined;
                readonly deployments: readonly ({
                    readonly schema_version: 1;
                    readonly network: {
                        readonly schema_version: 1;
                        readonly network_namespace: "eip155";
                        readonly network_reference: string;
                    };
                    readonly address: string;
                    readonly normalized_address: string;
                    readonly deployment_id: {
                        readonly algorithm: "sha-256";
                        readonly domain: string;
                        readonly major_version: number;
                        readonly digest: string;
                    };
                } | {
                    readonly schema_version: 1;
                    readonly network: {
                        readonly schema_version: 1;
                        readonly network_namespace: "solana";
                        readonly network_reference: string;
                    };
                    readonly address: string;
                    readonly normalized_address: string;
                    readonly deployment_id: {
                        readonly algorithm: "sha-256";
                        readonly domain: string;
                        readonly major_version: number;
                        readonly digest: string;
                    };
                })[];
                readonly equivalence_basis: {
                    readonly schema_version: 1;
                    readonly kind: "single_deployment";
                } | {
                    readonly schema_version: 1;
                    readonly kind: "registry";
                    readonly assertion_digest: {
                        readonly algorithm: "sha-256";
                        readonly domain: string;
                        readonly major_version: number;
                        readonly digest: string;
                    };
                } | {
                    readonly schema_version: 1;
                    readonly kind: "operator_ratified";
                    readonly assertion_digest: {
                        readonly algorithm: "sha-256";
                        readonly domain: string;
                        readonly major_version: number;
                        readonly digest: string;
                    };
                    readonly authority_ref: string;
                } | {
                    readonly schema_version: 1;
                    readonly kind: "protocol_link";
                    readonly assertion_digest: {
                        readonly algorithm: "sha-256";
                        readonly domain: string;
                        readonly major_version: number;
                        readonly digest: string;
                    };
                    readonly protocol: string;
                };
                readonly collection_id: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            };
            readonly provenance: readonly {
                readonly schema_version: 1;
                readonly source: "operator_ratified" | "protocol_link" | "onchain" | "sonar_probe" | "inventory_registry" | "external_metadata";
                readonly source_reference?: string | undefined;
                readonly observed_at: string;
                readonly evidence_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            }[];
            readonly schema_version: 1;
            readonly token_standard: {
                readonly value: string;
                readonly schema_version: 1;
            };
            readonly recognition: "recognized" | "ambiguous" | "unrecognized";
            readonly index_status: "unknown" | "indexed" | "indexing" | "missing" | "unsupported" | "failed";
            readonly report_readiness: "unknown" | "unsupported" | "ready" | "preparation_required" | "blocked";
            readonly metadata_quality: "onchain" | "registry_enriched" | "external_pointer" | "partial" | "unavailable";
            readonly finality_policies: readonly {
                readonly schema_version: 1;
                readonly network: {
                    readonly schema_version: 1;
                    readonly network_namespace: "eip155";
                    readonly network_reference: string;
                } | {
                    readonly schema_version: 1;
                    readonly network_namespace: "solana";
                    readonly network_reference: string;
                };
                readonly finality_policy_version: string;
            }[];
            readonly ranking_reasons: readonly string[];
        }[];
        schema_version: 1;
        diagnostics: {
            readonly schema_version: 1;
            readonly searched: readonly {
                readonly schema_version: 1;
                readonly network_namespace: "eip155" | "solana";
                readonly network_reference: string;
            }[];
            readonly timed_out: readonly {
                readonly schema_version: 1;
                readonly network_namespace: "eip155" | "solana";
                readonly network_reference: string;
            }[];
            readonly unavailable: readonly {
                readonly schema_version: 1;
                readonly network_namespace: "eip155" | "solana";
                readonly network_reference: string;
            }[];
        };
    };
    resolution_id: string;
    expires_at: string;
    schema_version: 1;
    candidate_snapshot_digest: {
        readonly algorithm: "sha-256";
        readonly domain: string;
        readonly major_version: number;
        readonly digest: string;
    };
    selected_deployment_ids?: readonly {
        readonly algorithm: "sha-256";
        readonly domain: string;
        readonly major_version: number;
        readonly digest: string;
    }[] | undefined;
    requester_subject: string;
    authorization_scope: {
        readonly schema_version: 1;
        readonly subject_id: string;
        readonly community_ref?: string | undefined;
        readonly permission: "report:create";
    };
    original_request: {
        readonly identifier: string;
        readonly schema_version: 1;
        readonly community_ref?: string | undefined;
        readonly environment: "mainnet";
        readonly report_type: string;
        readonly report_version: string;
    };
    request_digest: {
        readonly algorithm: "sha-256";
        readonly domain: string;
        readonly major_version: number;
        readonly digest: string;
    };
    capability_snapshot_version: {
        readonly registry_epoch: string;
        readonly registry_sequence: string;
    };
    selected_collection_id?: {
        readonly algorithm: "sha-256";
        readonly domain: string;
        readonly major_version: number;
        readonly digest: string;
    } | undefined;
    confirmation_version: number;
    confirmed_at?: string | undefined;
    created_at: string;
    updated_at: string;
}, import("effect/ParseResult").ParseError | import("@freeside/collection-protocol").CanonicalEncodingError | import("@freeside/collection-protocol").DigestComputationError | import("@freeside/collection-protocol").ContractIntegrityError, never>;
export declare const decodeResolutionPublicProjection: (input: unknown) => Effect.Effect<{
    candidates: {
        readonly identity: {
            readonly symbol?: string | undefined;
            readonly schema_version: 1;
            readonly collection_key?: string | undefined;
            readonly name?: string | undefined;
            readonly image?: string | undefined;
            readonly deployments: readonly ({
                readonly schema_version: 1;
                readonly network: {
                    readonly schema_version: 1;
                    readonly network_namespace: "eip155";
                    readonly network_reference: string;
                };
                readonly address: string;
                readonly normalized_address: string;
                readonly deployment_id: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            } | {
                readonly schema_version: 1;
                readonly network: {
                    readonly schema_version: 1;
                    readonly network_namespace: "solana";
                    readonly network_reference: string;
                };
                readonly address: string;
                readonly normalized_address: string;
                readonly deployment_id: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            })[];
            readonly equivalence_basis: {
                readonly schema_version: 1;
                readonly kind: "single_deployment";
            } | {
                readonly schema_version: 1;
                readonly kind: "registry";
                readonly assertion_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
            } | {
                readonly schema_version: 1;
                readonly kind: "operator_ratified";
                readonly assertion_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
                readonly authority_ref: string;
            } | {
                readonly schema_version: 1;
                readonly kind: "protocol_link";
                readonly assertion_digest: {
                    readonly algorithm: "sha-256";
                    readonly domain: string;
                    readonly major_version: number;
                    readonly digest: string;
                };
                readonly protocol: string;
            };
            readonly collection_id: {
                readonly algorithm: "sha-256";
                readonly domain: string;
                readonly major_version: number;
                readonly digest: string;
            };
        };
        readonly provenance: readonly {
            readonly schema_version: 1;
            readonly source: "operator_ratified" | "protocol_link" | "onchain" | "sonar_probe" | "inventory_registry" | "external_metadata";
            readonly source_reference?: string | undefined;
            readonly observed_at: string;
            readonly evidence_digest: {
                readonly algorithm: "sha-256";
                readonly domain: string;
                readonly major_version: number;
                readonly digest: string;
            };
        }[];
        readonly schema_version: 1;
        readonly token_standard: {
            readonly value: string;
            readonly schema_version: 1;
        };
        readonly recognition: "recognized" | "ambiguous" | "unrecognized";
        readonly index_status: "unknown" | "indexed" | "indexing" | "missing" | "unsupported" | "failed";
        readonly report_readiness: "unknown" | "unsupported" | "ready" | "preparation_required" | "blocked";
        readonly metadata_quality: "onchain" | "registry_enriched" | "external_pointer" | "partial" | "unavailable";
        readonly finality_policies: readonly {
            readonly schema_version: 1;
            readonly network: {
                readonly schema_version: 1;
                readonly network_namespace: "eip155";
                readonly network_reference: string;
            } | {
                readonly schema_version: 1;
                readonly network_namespace: "solana";
                readonly network_reference: string;
            };
            readonly finality_policy_version: string;
        }[];
        readonly ranking_reasons: readonly string[];
    }[];
    resolution_id: string;
    expires_at: string;
    schema_version: 1;
    candidate_snapshot_digest: {
        readonly algorithm: "sha-256";
        readonly domain: string;
        readonly major_version: number;
        readonly digest: string;
    };
    selected_deployment_ids?: readonly {
        readonly algorithm: "sha-256";
        readonly domain: string;
        readonly major_version: number;
        readonly digest: string;
    }[] | undefined;
    diagnostics: {
        readonly schema_version: 1;
        readonly searched: readonly {
            readonly schema_version: 1;
            readonly network_namespace: "eip155" | "solana";
            readonly network_reference: string;
        }[];
        readonly timed_out: readonly {
            readonly schema_version: 1;
            readonly network_namespace: "eip155" | "solana";
            readonly network_reference: string;
        }[];
        readonly unavailable: readonly {
            readonly schema_version: 1;
            readonly network_namespace: "eip155" | "solana";
            readonly network_reference: string;
        }[];
    };
    capability_snapshot_version: {
        readonly registry_epoch: string;
        readonly registry_sequence: string;
    };
    selected_collection_id?: {
        readonly algorithm: "sha-256";
        readonly domain: string;
        readonly major_version: number;
        readonly digest: string;
    } | undefined;
    confirmation_version: number;
    confirmed_at?: string | undefined;
    selection_stale?: true | undefined;
}, import("effect/ParseResult").ParseError | import("@freeside/collection-protocol").CanonicalEncodingError | import("@freeside/collection-protocol").DigestComputationError | import("@freeside/collection-protocol").ContractIntegrityError, never>;
/**
 * Strict-decode a local capability snapshot and canonicalize `views` as a
 * unique sorted set keyed by (deployment_id, operation). Identical duplicates
 * and contradictory duplicates both fail closed — never first-match.
 */
export declare const decodeLocalCapabilitySnapshot: (input: unknown) => Effect.Effect<{
    views: readonly {
        readonly equivalence_revoked: boolean;
        readonly operation: "recognize" | "prepare" | "read_evidence";
        readonly schema_version: 1;
        readonly network_namespace: "eip155" | "solana";
        readonly network_reference: string;
        readonly normalized_address: string;
        readonly deployment_id: {
            readonly algorithm: "sha-256";
            readonly domain: string;
            readonly major_version: number;
            readonly digest: string;
        };
        readonly finality_policy_version: string;
        readonly health: "available" | "degraded" | "disabled";
        readonly supported_standards: readonly string[];
        readonly authorization_valid: boolean;
        readonly identity_digest: {
            readonly algorithm: "sha-256";
            readonly domain: string;
            readonly major_version: number;
            readonly digest: string;
        };
    }[];
    schema_version: 1;
    registry_version: {
        readonly registry_epoch: string;
        readonly registry_sequence: string;
    };
    receipt_age_ms: number;
    staleness_ceiling_ms: number;
}, ContractIntegrityError | import("effect/ParseResult").ParseError, never>;
export declare const decodeAdmissionDecision: (u: unknown, overrideOptions?: ParseOptions) => Effect.Effect<{
    readonly resolution_id: string;
    readonly schema_version: 1;
    readonly candidate_snapshot_digest: {
        readonly algorithm: "sha-256";
        readonly domain: string;
        readonly major_version: number;
        readonly digest: string;
    };
    readonly selected_deployment_ids: readonly {
        readonly algorithm: "sha-256";
        readonly domain: string;
        readonly major_version: number;
        readonly digest: string;
    }[];
    readonly selected_collection_id?: {
        readonly algorithm: "sha-256";
        readonly domain: string;
        readonly major_version: number;
        readonly digest: string;
    } | undefined;
    readonly admitted_registry_version: {
        readonly registry_epoch: string;
        readonly registry_sequence: string;
    };
    readonly compatibility_digest: {
        readonly algorithm: "sha-256";
        readonly domain: string;
        readonly major_version: number;
        readonly digest: string;
    };
    readonly decision: "selection_stale" | "admit" | "capability_view_stale" | "refuse";
}, import("effect/ParseResult").ParseError, never>;
export declare const decodeAuthorizationScope: (u: unknown, overrideOptions?: ParseOptions) => Effect.Effect<{
    readonly schema_version: 1;
    readonly subject_id: string;
    readonly community_ref?: string | undefined;
    readonly permission: "report:create";
}, import("effect/ParseResult").ParseError, never>;
export declare const toPublicProjection: (record: ConfirmedResolutionRecord, options?: {
    readonly selection_stale?: true;
}) => ResolutionPublicProjection;
export declare const expiresAtFrom: (nowMs: number, ttlMs?: number) => string;
export declare const assertNoRawCandidateOrderFields: (input: Readonly<Record<string, unknown>>) => Effect.Effect<void, ContractIntegrityError>;
export declare const scopesMatch: (left: AuthorizationScope, right: AuthorizationScope) => boolean;
export declare const requestMaterialFromCreate: (command: ResolutionCreateCommand) => ResolutionRequestMaterial;
export declare const requestMaterialsEqual: (left: ResolutionRequestMaterial, right: ResolutionRequestMaterial) => boolean;
export { digestKey, isStrictlySortedUnique, decodeCapabilityRegistryVersion };
//# sourceMappingURL=contracts.d.ts.map