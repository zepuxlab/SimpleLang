declare global {
  const figma: {
    currentPage: {
      children: readonly SceneNode[];
      selection: readonly SceneNode[];
      appendChild: (node: SceneNode) => SceneNode;
    };
    showUI: (html: string, opts?: { width?: number; height?: number }) => void;
    ui: { postMessage: (msg: unknown) => void; onmessage: (handler: (msg: unknown) => void) => void };
    viewport: { scrollAndZoomIntoView: (nodes: readonly SceneNode[]) => void };
    loadFontAsync: (font: FontName) => Promise<void>;
    mixed: symbol;
    clientStorage: {
      getAsync: (key: string) => Promise<string | undefined>;
      setAsync: (key: string, value: string) => Promise<void>;
      deleteAsync: (key: string) => Promise<void>;
    };
  };
  interface SceneNode {
    id: string;
    type: string;
    name: string;
    parent: SceneNode | null;
    readonly children?: readonly SceneNode[];
    clone(): SceneNode;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }
  interface TextNode extends SceneNode {
    type: "TEXT";
    characters: string;
    fontName: FontName | symbol;
    textAlignHorizontal: string;
    textAlignVertical: string;
    textAutoResize?: "NONE" | "WIDTH" | "HEIGHT" | "WIDTH_AND_HEIGHT";
  }
  interface FontName {
    family: string;
    style: string;
  }
}

export {};
