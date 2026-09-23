/**
 * The space around each file, which is what makes a new file read as a new
 * file rather than more of the last one: this much above a file, and a little
 * below the one before it.
 *
 * It goes to the viewer as its own layout rather than as CSS margins, because
 * the viewer works out where every file sits from their heights and its gap,
 * and a margin it did not know about would move every file after the first.
 * The gap belongs to neither file, so anything working out which file is on
 * screen has to allow for it.
 */
export const SPACE_ABOVE_FILE = 26;
const SPACE_BELOW_FILE = 5;
export const FILE_GAP = SPACE_ABOVE_FILE + SPACE_BELOW_FILE;

/**
 * The curve inside a file's border: its 6px radius, less the 1px border, both
 * set on `diffs-container` in the viewer's stylesheet
 */
export const INNER_RADIUS = 5;
