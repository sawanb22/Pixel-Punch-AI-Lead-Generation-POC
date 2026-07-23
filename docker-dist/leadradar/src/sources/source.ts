import type { CanonicalLead } from "../domain/types.js";

/** Injectable fetch for HTTP adapters (tests never hit the network). */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

/** Every lead source implements this: produce canonical leads. */
export interface Source {
  readonly name: string;
  fetch(): Promise<CanonicalLead[]>;
}
