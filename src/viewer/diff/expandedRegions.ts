import type { FileDiffMetadata } from '@pierre/diffs';

import type { Expansion } from '@/patch/findInPatch';

/**
 * Which collapsed gaps the reader has opened, per file, for find to search.
 *
 * The viewer keeps this on each file's renderer and offers no public way to read
 * it, so this is the one place that reaches past its interface. It is read after
 * each render, when the viewer hands the file's instance over, and remembered
 * against the file, since instances outlive the rows they draw. If the shape is
 * ever not there, opened gaps drop out of find and the patch is still searched.
 * `docs/upstream.md#expanded-regions` asks for a public way in.
 *
 * Keyed by the `FileDiffMetadata` object itself, the one the session holds.
 * That works because the viewer loads a whole file into that same object
 * (`hydratePartialDiff` in `"merge"` mode sets `isPartial` to false and fills
 * `additionLines` in place) rather than into a copy. `findInPatch.ts` reads
 * the full lines from it for the same reason. If the viewer ever loads into a
 * copy, the keys stop matching and opened gaps drop out of find.
 */
export interface ExpansionMemory {
  /** Answers whether anything find depends on changed */
  record: (instance: unknown) => boolean;
  /** What is known now, as a value of its own, so a change can be told from no change */
  snapshot: () => ExpansionSnapshot;
}

export type ExpansionSnapshot = ReadonlyMap<FileDiffMetadata, Expansion>;

interface Rendered {
  fileDiff?: FileDiffMetadata;
  hunksRenderer?: { getExpandedHunksMap?: () => unknown };
}

export function createExpansionMemory(): ExpansionMemory {
  const known = new Map<FileDiffMetadata, { loaded: boolean; regions: Expansion }>();

  return {
    record(instance) {
      const { fileDiff, hunksRenderer } = (instance ?? {}) as Rendered;
      const regions = hunksRenderer?.getExpandedHunksMap?.();
      if (fileDiff == null || !(regions instanceof Map)) return false;

      const before = known.get(fileDiff);
      const loaded = !fileDiff.isPartial;
      const copy: Expansion = new Map(regions as Expansion);
      known.set(fileDiff, { loaded, regions: copy });
      return before == null
        ? loaded || copy.size > 0
        : before.loaded !== loaded || !same(before.regions, copy);
    },
    snapshot: () => new Map([...known].map(([fileDiff, { regions }]) => [fileDiff, regions])),
  };
}

function same(a: Expansion, b: Expansion): boolean {
  if (a.size !== b.size) return false;
  for (const [index, region] of a) {
    const other = b.get(index);
    if (other?.fromStart !== region.fromStart || other.fromEnd !== region.fromEnd) return false;
  }
  return true;
}
