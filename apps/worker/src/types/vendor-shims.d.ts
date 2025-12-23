declare module "unzipper";

declare module "xml2js" {
  export const parseStringPromise: (xml: string, options?: unknown) => Promise<any>;
}
