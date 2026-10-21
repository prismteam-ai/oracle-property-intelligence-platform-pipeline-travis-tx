import { describe, expect, it } from 'vitest';
import {
  GetPropertyInput,
  coerceQuery,
  searchPermitsParams,
  searchPropertiesParams,
  textSearchParams,
} from '../src/index.js';

describe('REST query coercion + defaults', () => {
  it('coerces numbers, booleans and comma lists, then applies contract defaults', () => {
    const schema = searchPermitsParams('rest');
    const q = schema.parse(
      coerceQuery(schema, {
        lat: '30.27',
        lon: '-97.74',
        status_group: 'open,stalled,closed',
        roofing_only: 'false',
      }),
    );
    expect(q).toMatchObject({
      lat: 30.27,
      radius_miles: 5,
      status_group: ['open', 'stalled', 'closed'],
      roofing_only: false,
      limit: 50,
    });
  });
  it('text search defaults: match=all, all four groups, roofing_only=false', () => {
    const schema = textSearchParams('rest');
    expect(schema.parse(coerceQuery(schema, { q: 'hail damage' }))).toMatchObject({
      match: 'all',
      roofing_only: false,
      status_group: ['open', 'stalled', 'closed', 'needs_review'],
    });
  });
  it('rejects lat without lon, q over 200 chars and limit over the cap', () => {
    const s = searchPropertiesParams('rest');
    expect(s.safeParse(coerceQuery(s, { lat: '30' })).success).toBe(false);
    expect(textSearchParams('rest').safeParse({ q: 'x'.repeat(201) }).success).toBe(false);
    expect(s.safeParse({ limit: 501 }).success).toBe(false);
  });
  it('MCP variant: open_permits is required, limit default 20 max 50', () => {
    const s = searchPropertiesParams('mcp');
    expect(s.safeParse({}).success).toBe(false);
    expect(s.parse({ open_permits: false })).toMatchObject({ limit: 20 });
    expect(s.safeParse({ open_permits: true, limit: 51 }).success).toBe(false);
  });
  it('get_property takes exactly one id', () => {
    expect(GetPropertyInput.safeParse({ property_id: '1' }).success).toBe(true);
    expect(GetPropertyInput.safeParse({ property_id: '1', geo_id: '2' }).success).toBe(false);
    expect(GetPropertyInput.safeParse({}).success).toBe(false);
  });
});
