export interface GenerateRequest {
  /** Source photo bytes. */
  image: Uint8Array;
  imageMimeType: string;
  prompt: string;
}

export interface GenerateResult {
  /** PNG with an alpha channel. */
  png: Uint8Array;
  provider: string;
  model: string;
}

export interface IdeaRequest {
  topic: string;
  locale: string;
  count: number;
}

export interface ImageProvider {
  readonly name: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
  suggestIdeas(request: IdeaRequest): Promise<string[]>;
}
