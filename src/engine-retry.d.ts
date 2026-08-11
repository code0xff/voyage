// Query-suffixed imports are distinct URLs so a failed module fetch can be
// retried after the browser caches the original rejection.
declare module "@/engine?retry=1" {
  export * from "@/engine";
}

declare module "@/engine?retry=2" {
  export * from "@/engine";
}

declare module "@/engine?retry=3" {
  export * from "@/engine";
}
