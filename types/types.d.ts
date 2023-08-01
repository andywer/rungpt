import { z } from "zod";

export type Brand<T, Id extends string> = T & z.BRAND<Id>;

////////////////
// Primitives

export type ISODateTimeString = Brand<string, "ISODateTimeString">;

////////////////
// Identifiers

/** ID of a an AI agent chain (like basic chat, plan & execute, …) */
export type ChainID = Brand<string, "ChainID">;

/** ID of a langchain model */
export type ModelID = Brand<string, "ModelID">;

/** ID of a langchain tool */
export type ToolID = Brand<string, "ToolID">;

/** IF of a single session (i.e. one particular chat) */
export type SessionID = Brand<string, "SessionID">;
