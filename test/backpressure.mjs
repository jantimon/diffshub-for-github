/**
 * Proves the cache does not drain the network ahead of the reader.
 *
 * The viewer parses a patch against a work budget, a few files a turn. Whatever
 * keeps a copy of that patch has to be pulled by the same reader, or it races
 * ahead, takes the download at full speed, and everything the parser has not
 * reached yet waits in memory -- twenty megabytes of it on the pull request this
 * viewer was built for.
 *
 * A split stream does exactly that: it pulls its source whenever either half
 * pulls. A pass-through does not. This is the difference, measured.
 *
 * Offline. It builds a source and a slow reader by hand.
 */

const CHUNKS = 200;
const CHUNK_BYTES = 64 * 1024;
const READER_DELAY_MS = 2;

let failures = 0;

const check = (name, value, detail) => {
  if (value === true) {
    console.log(`ok   ${name}${detail == null ? '' : ` — ${detail}`}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${name}${detail == null ? '' : ` — ${detail}`}`);
};

/** A source that says how much of it has been asked for */
function countingSource() {
  const state = { produced: 0 };
  const stream = new ReadableStream({
    pull(controller) {
      if (state.produced >= CHUNKS) {
        controller.close();
        return;
      }
      state.produced += 1;
      controller.enqueue(new Uint8Array(CHUNK_BYTES));
    },
  });
  return { stream, state };
}

/** Reads a handful of chunks slowly, the way the patch parser does */
async function readSlowly(stream, count) {
  const reader = stream.getReader();
  for (let at = 0; at < count; at += 1) {
    const { done } = await reader.read();
    if (done) break;
    await new Promise((resolve) => setTimeout(resolve, READER_DELAY_MS));
  }
  await reader.cancel();
}

// What the cache does today: one stream, passed through, copies kept as it goes
{
  const { stream, state } = countingSource();
  const copied = [];
  const passed = stream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        copied.push(chunk);
      },
    }),
  );
  await readSlowly(passed, 10);
  check(
    'a pass-through reads no further than the reader does',
    state.produced <= 14,
    `${state.produced} chunks produced for 10 read`,
  );
  // Not every chunk the source made: the last one or two are still queued when
  // the reader gives up. Every chunk that reached the reader, which is the copy
  // that matters
  check(
    'and it copies everything that reached the reader',
    copied.length >= 10 && copied.length <= state.produced,
    `${copied.length} copied of ${state.produced} produced`,
  );
}

// What it used to do, kept here so the difference is not a matter of opinion
{
  const { stream, state } = countingSource();
  const [toReader, toCache] = stream.tee();
  void (async () => {
    const reader = toCache.getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
  })();
  await readSlowly(toReader, 10);
  check(
    'a split stream drains the whole source regardless',
    state.produced > 100,
    `${state.produced} chunks produced for the same 10 read`,
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
