/**
 * Ruby stacks as Datadog stores them. The first line also carries the error message,
 * which the caller controls, so parsing keeps only file, line and method, never the
 * rest of a line.
 *
 *   /app/app/models/artwork.rb:12:in 'Artwork#price': undefined method ... (NoMethodError)
 *   \tfrom /usr/local/bundle/gems/grape-2.4.0/lib/grape/endpoint.rb:58:in 'bind_call'
 */

export interface Frame {
  file: string
  line: number
  method: string
}

const FRAME =
  /^\s*(?:from\s+)?([^\s:'`]+):(\d+)(?::in\s+['`]([^'`]{0,200})['`])?/

/**
 * Ruby method and block labels, e.g. `Artwork#title` or `block (2 levels) in
 * <class:Foo>`. Anything else, such as prose, is dropped.
 */
const SAFE_METHOD =
  /^(?:(?:block|rescue|ensure)(?: \(\d+ levels\))? in )*[\w:#.?!=<>[\]()+\-*/%&|^~]{1,120}$/

export const parseStack = (stack: string): Frame[] =>
  stack
    .split("\n")
    .map(line => FRAME.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, file, line, method]) => ({
      file,
      line: Number(line),
      method: method && SAFE_METHOD.test(method) ? method : "",
    }))

/** Where the app lives in the production image. */
const APP_ROOT = "/app/"

const VENDORED = /(^|\/)(vendor|bundle|gems|node_modules)\//

/**
 * The repo-relative path of a first-party frame, or null for gems, the Ruby stdlib
 * and anything outside the app. Accepts `/app/app/x.rb` and an already-relative
 * `app/x.rb`.
 */
export const repoPath = (file: string): string | null => {
  const relative = file.startsWith(APP_ROOT)
    ? file.slice(APP_ROOT.length)
    : file.startsWith("/")
      ? null
      : file.replace(/^\.\//, "")
  if (
    !relative ||
    !/^[\w][\w./-]*$/.test(relative) ||
    VENDORED.test(relative) ||
    relative.split("/").includes("..")
  ) {
    return null
  }
  return relative
}

export interface InAppFrame extends Frame {
  path: string
}

export const inAppFrames = (frames: Frame[]): InAppFrame[] =>
  frames.flatMap(frame => {
    const path = repoPath(frame.file)
    return path ? [{ ...frame, path }] : []
  })
