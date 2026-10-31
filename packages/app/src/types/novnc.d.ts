// noVNC 1.7 exposes its ESM entry at the package root. DefinitelyTyped 1.6
// still declares the RFB API under the former path; reuse those types only.
declare module "@novnc/novnc" {
  export { default } from "@novnc/novnc/lib/rfb"
}
