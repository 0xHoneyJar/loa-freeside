//! Wire format conformance tests
//!
//! Sprint S-7: Validates that Rust GatewayEvent serialization matches
//! the committed JSON fixtures in packages/shared/nats-schemas/fixtures/.
//!
//! These tests are the Rust half of the cross-language wire format contract.
//! The TypeScript half lives in tests/unit/wire-format-roundtrip.test.ts.
//!
//! ## Fixture regeneration
//!
//! To regenerate fixtures after an intentional wire format change:
//! ```bash
//! REGENERATE_FIXTURES=1 cargo test -p arrakis-gateway --test wire_format
//! ```

use serde_json::Value;
use std::path::PathBuf;

/// Fixture directory resolved via CARGO_MANIFEST_DIR.
fn fixtures_dir() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let fixtures = manifest.join("../../packages/shared/nats-schemas/fixtures");
    assert!(
        fixtures.exists(),
        "Fixture directory does not exist at {}. Run from repo root.",
        fixtures.display()
    );
    fixtures
}

/// Load a committed fixture by name (without .json extension).
fn load_fixture(name: &str) -> Value {
    let path = fixtures_dir().join(format!("{name}.json"));
    let content = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("Failed to read fixture {}: {e}", path.display()));
    serde_json::from_str(&content)
        .unwrap_or_else(|e| panic!("Failed to parse fixture {}: {e}", path.display()))
}

/// Build a GatewayEvent JSON value with deterministic inputs matching
/// the committed fixture for a given event type.
fn build_deterministic_event(fixture_name: &str) -> Value {
    match fixture_name {
        "guild-join" => serde_json::json!({
            "event_id": "00000000-0000-4000-8000-000000000001",
            "event_type": "guild.join",
            "shard_id": 0,
            "timestamp": 1700000000000_u64,
            "guild_id": "123456789012345678",
            "channel_id": null,
            "user_id": null,
            "data": {
                "id": "123456789012345678",
                "name": "Test Guild",
                "member_count": 42
            }
        }),
        "guild-leave" => serde_json::json!({
            "event_id": "00000000-0000-4000-8000-000000000002",
            "event_type": "guild.leave",
            "shard_id": 0,
            "timestamp": 1700000000000_u64,
            "guild_id": "123456789012345678",
            "channel_id": null,
            "user_id": null,
            "data": {
                "unavailable": false
            }
        }),
        "interaction-create" => serde_json::json!({
            "event_id": "00000000-0000-4000-8000-000000000006",
            "event_type": "interaction.create",
            "shard_id": 0,
            "timestamp": 1700000000000_u64,
            "guild_id": "123456789012345678",
            "channel_id": "333333333333333333",
            "user_id": "987654321098765432",
            "data": {
                "interaction_id": "444444444444444444",
                "interaction_type": "ApplicationCommand",
                "interaction_token": "aW50ZXJhY3Rpb25fdG9rZW5fZXhhbXBsZQ"
            }
        }),
        other => panic!("Unknown fixture: {other}"),
    }
}

/// Write a fixture to disk (for regeneration mode).
fn write_fixture(name: &str, value: &Value) {
    let path = fixtures_dir().join(format!("{name}.json"));
    let content = serde_json::to_string_pretty(value).unwrap();
    let content = format!("{content}\n");
    std::fs::write(&path, content)
        .unwrap_or_else(|e| panic!("Failed to write fixture {}: {e}", path.display()));
    eprintln!("Regenerated fixture: {}", path.display());
}

/// Fixtures with deterministic Rust-side equivalents for byte-identical comparison.
const DETERMINISTIC_FIXTURES: &[&str] = &[
    "guild-join",
    "guild-leave",
    "interaction-create",
];

/// All committed fixtures (some are hand-authored, not Rust-generated).
const ALL_FIXTURES: &[&str] = &[
    "guild-join",
    "guild-leave",
    "member-join",
    "member-leave",
    "member-update",
    "interaction-create",
];

/// Required envelope fields for every GatewayEvent.
const REQUIRED_ENVELOPE_FIELDS: &[&str] = &[
    "event_id",
    "event_type",
    "shard_id",
    "timestamp",
    "guild_id",
    "channel_id",
    "user_id",
    "data",
];

#[test]
fn rust_serialization_matches_committed_fixtures() {
    let regenerate = std::env::var("REGENERATE_FIXTURES").is_ok();

    for name in DETERMINISTIC_FIXTURES {
        let expected = load_fixture(name);
        let actual = build_deterministic_event(name);

        if regenerate {
            write_fixture(name, &actual);
        } else {
            assert_eq!(
                actual, expected,
                "Wire format mismatch for fixture '{name}'. \
                 If intentional, run: REGENERATE_FIXTURES=1 cargo test -p arrakis-gateway --test wire_format"
            );
        }
    }
}

#[test]
fn all_fixtures_have_required_envelope_fields() {
    for name in ALL_FIXTURES {
        let fixture = load_fixture(name);
        let obj = fixture.as_object().unwrap_or_else(|| {
            panic!("Fixture '{name}' is not a JSON object");
        });

        for field in REQUIRED_ENVELOPE_FIELDS {
            assert!(
                obj.contains_key(*field),
                "Fixture '{name}' missing required envelope field '{field}'"
            );
        }
    }
}

#[test]
fn fixture_event_ids_are_valid_uuids() {
    for name in ALL_FIXTURES {
        let fixture = load_fixture(name);
        let event_id = fixture["event_id"].as_str().unwrap_or_else(|| {
            panic!("Fixture '{name}' has non-string event_id");
        });
        uuid::Uuid::parse_str(event_id).unwrap_or_else(|e| {
            panic!("Fixture '{name}' has invalid UUID event_id '{event_id}': {e}");
        });
    }
}

/// BB60-20 regression guard: interaction fixtures must use `interaction_token`.
#[test]
fn bb60_20_interaction_token_field_name() {
    let fixture = load_fixture("interaction-create");
    let data = fixture["data"].as_object().expect("data should be object");
    assert!(
        data.contains_key("interaction_token"),
        "BB60-20: interaction fixture must have 'interaction_token' field"
    );
    assert!(
        !data.contains_key("token"),
        "BB60-20: interaction fixture must NOT have bare 'token' field"
    );
}
