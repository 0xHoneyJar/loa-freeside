/**
 * Wire format round-trip tests — TypeScript side
 *
 * Sprint S-7, Task S7-T1
 *
 * Validates that committed JSON fixtures parse through all Zod schemas
 * without error. This is the TypeScript half of the cross-language wire
 * format contract. The Rust half lives in apps/gateway/tests/wire_format.rs.
 *
 * If this test fails, either:
 * 1. A Zod schema changed in a way that rejects a valid fixture, OR
 * 2. A fixture was updated without updating the corresponding schema.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GatewayEventSchema,
  InteractionPayloadSchema,
  InteractionTransportPayloadSchema,
  GuildJoinDataSchema,
  GuildLeaveDataSchema,
  MemberJoinDataSchema,
  MemberLeaveDataSchema,
  MemberUpdateDataSchema,
  InteractionCreateDataSchema,
  KNOWN_EVENT_TYPES,
  isKnownEventType,
} from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../../fixtures');

function loadFixture(name: string): unknown {
  const content = readFileSync(resolve(FIXTURES_DIR, `${name}.json`), 'utf-8');
  return JSON.parse(content);
}

const ALL_FIXTURES = [
  'guild-join',
  'guild-leave',
  'member-join',
  'member-leave',
  'member-update',
  'interaction-create',
];

describe('Wire format round-trip (TypeScript side)', () => {
  describe('All fixtures validate against GatewayEventSchema', () => {
    for (const name of ALL_FIXTURES) {
      it(`${name} parses as GatewayEvent`, () => {
        const fixture = loadFixture(name);
        const result = GatewayEventSchema.safeParse(fixture);
        expect(result.success).toBe(true);
      });
    }
  });

  describe('Event-specific data validation', () => {
    it('guild-join data validates against GuildJoinDataSchema', () => {
      const fixture = loadFixture('guild-join') as { data: unknown };
      const result = GuildJoinDataSchema.safeParse(fixture.data);
      expect(result.success).toBe(true);
    });

    it('guild-leave data validates against GuildLeaveDataSchema', () => {
      const fixture = loadFixture('guild-leave') as { data: unknown };
      const result = GuildLeaveDataSchema.safeParse(fixture.data);
      expect(result.success).toBe(true);
    });

    it('member-join data validates against MemberJoinDataSchema', () => {
      const fixture = loadFixture('member-join') as { data: unknown };
      const result = MemberJoinDataSchema.safeParse(fixture.data);
      expect(result.success).toBe(true);
    });

    it('member-leave data validates against MemberLeaveDataSchema', () => {
      const fixture = loadFixture('member-leave') as { data: unknown };
      const result = MemberLeaveDataSchema.safeParse(fixture.data);
      expect(result.success).toBe(true);
    });

    it('member-update data validates against MemberUpdateDataSchema', () => {
      const fixture = loadFixture('member-update') as { data: unknown };
      const result = MemberUpdateDataSchema.safeParse(fixture.data);
      expect(result.success).toBe(true);
    });

    it('interaction-create data validates against InteractionCreateDataSchema', () => {
      const fixture = loadFixture('interaction-create') as { data: unknown };
      const result = InteractionCreateDataSchema.safeParse(fixture.data);
      expect(result.success).toBe(true);
    });
  });

  describe('Interaction payload schemas', () => {
    it('interaction-create validates against InteractionPayloadSchema (enriched)', () => {
      const fixture = loadFixture('interaction-create');
      const result = InteractionPayloadSchema.safeParse(fixture);
      expect(result.success).toBe(true);
    });

    it('interaction-create validates against InteractionTransportPayloadSchema (strict)', () => {
      const fixture = loadFixture('interaction-create');
      const result = InteractionTransportPayloadSchema.safeParse(fixture);
      expect(result.success).toBe(true);
    });
  });

  describe('KNOWN_EVENT_TYPES coverage', () => {
    it('all fixture event types are known', () => {
      for (const name of ALL_FIXTURES) {
        const fixture = loadFixture(name) as { event_type: string };
        expect(isKnownEventType(fixture.event_type)).toBe(true);
      }
    });

    it('unknown event type returns false', () => {
      expect(isKnownEventType('unknown.event')).toBe(false);
    });

    it('KNOWN_EVENT_TYPES has expected length', () => {
      expect(KNOWN_EVENT_TYPES.length).toBe(7);
    });
  });

  describe('JSON round-trip stability', () => {
    it('parse → serialize → parse produces identical results', () => {
      for (const name of ALL_FIXTURES) {
        const fixture = loadFixture(name);
        const parsed = GatewayEventSchema.parse(fixture);
        const reserialized = JSON.parse(JSON.stringify(parsed));
        const reparsed = GatewayEventSchema.parse(reserialized);
        expect(reparsed).toEqual(parsed);
      }
    });
  });
});
