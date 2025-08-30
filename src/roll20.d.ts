/* Minimal Type Definitions for Roll20 API Globals (for editor code completion)
   This file provides IntelliSense for common Roll20 API functions/objects
   in plain JavaScript projects. Add/extend as needed for your script. */

declare global {
  type Roll20EventName =
    | "ready"
    | "chat:message"
    | `add:${string}`
    | `change:${string}`
    | `destroy:${string}`;

  type Roll20ObjectType =
    | "campaign"
    | "character"
    | "graphic"
    | "handout"
    | "ability"
    | "attribute"
    | "page"
    | "text"
    | "path"
    | "player"
    | "rollabletable"
    | "tableitem";

  interface Roll20Object {
    id: string;
    _id?: string;
    _type: Roll20ObjectType | string;
    get<T = any>(prop: string): T;
    set(prop: string, value: any): void;
    set(props: Record<string, any>): void;
    remove(): void;
  }

  interface Player extends Roll20Object {
    _type: "player";
  }
  interface CampaignObject extends Roll20Object {
    _type: "campaign";
  }
  interface Character extends Roll20Object {
    _type: "character";
  }
  interface Graphic extends Roll20Object {
    _type: "graphic";
  }
  interface Handout extends Roll20Object {
    _type: "handout";
  }
  interface Ability extends Roll20Object {
    _type: "ability";
  }
  interface Attribute extends Roll20Object {
    _type: "attribute";
  }
  interface Page extends Roll20Object {
    _type: "page";
  }
  interface Text extends Roll20Object {
    _type: "text";
  }
  interface Path extends Roll20Object {
    _type: "path";
  }
  interface RollableTable extends Roll20Object {
    _type: "rollabletable";
  }
  interface TableItem extends Roll20Object {
    _type: "tableitem";
  }

  interface InlineRollResult {
    expression: string;
    results: any;
    total: number;
    table?: any;
    dice?: any;
    rollid?: string;
  }

  interface SelectedItem {
    _id: string;
    _type: Roll20ObjectType;
  }

  type ChatMessageType =
    | "general"
    | "whisper"
    | "rollresult"
    | "gmrollresult"
    | "emote"
    | "api"
    | string;

  interface ChatMessage {
    type: ChatMessageType;
    content: string;
    who: string;
    playerid: string;
    inlinerolls?: InlineRollResult[];
    selected?: SelectedItem[];
    rolltemplate?: string;
    original?: string;
    target?: string;
  }

  // Core event system
  function on(event: Roll20EventName, callback: (msgOrObj?: any, prev?: any) => void): void;

  // Messaging & logging
  function sendChat(
    speakingAs: string,
    message: string,
    callback?: (ops: { who: string; content: string }[]) => void,
    options?: { noarchive?: boolean }
  ): void;
  function log(message?: any): void;

  // Objects
  function createObj<T extends Roll20Object = Roll20Object>(type: Roll20ObjectType, attrs: Record<string, any>): T;
  function getObj<T extends Roll20Object = Roll20Object>(type: Roll20ObjectType, id: string): T | undefined;
  function findObjs(attrs: Record<string, any>): Roll20Object[];
  function filterObjs(predicate: (o: Roll20Object) => boolean): Roll20Object[];
  function getAllObjs(): Roll20Object[];

  // Utilities
  function playerIsGM(playerId: string): boolean;
  function randomInteger(max: number): number;
  function toFront(obj: Roll20Object): void;
  function toBack(obj: Roll20Object): void;
  function getAttrByName(
    characterId: string,
    attrName: string,
    valueType?: string,
    max?: boolean
  ): string | number | undefined;
  function setDefaultTokenForCharacter(character: Character, graphic: Graphic): void;

  // FX & Map
  function spawnFx(x: number, y: number, type: string, pageid?: string): void;
  function spawnFxBetweenPoints(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    type: string,
    pageid?: string
  ): void;
  function spawnFxWithDefinition(x: number, y: number, def: object, pageid?: string): void;
  function sendPing(
    x: number,
    y: number,
    pageid: string,
    playerid?: string,
    moveAll?: boolean,
    visibleTo?: string,
    isDrawing?: boolean
  ): void;

  // Campaign getter
  const Campaign: {
    (): CampaignObject;
  };

  // Persistent state object
  const state: Record<string, any>;
}

export {};
