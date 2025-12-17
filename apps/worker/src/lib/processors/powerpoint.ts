import * as unzipper from "unzipper";
import { parseStringPromise } from "xml2js";

export interface PowerPointContent {
  metadata: {
    title?: string;
    author?: string;
    created?: string;
    totalSlides: number;
  };
  slides: Array<{
    slideNumber: number;
    title?: string;
    text: string;
    bullets: string[];
    images: Array<{
      index: number;
      description?: string;
    }>;
    notes?: string;
  }>;
  summary: {
    mainTopics: string[];
    keyMessages: string[];
    visualElements: number;
    totalText: string;
  };
}

export async function extractPowerPointContent(buffer: Buffer): Promise<PowerPointContent> {
  const slides: PowerPointContent["slides"] = [];
  const allText: string[] = [];
  const topics: Set<string> = new Set();

  try {
    const directory = await unzipper.Open.buffer(buffer);
    
    // Get presentation metadata
    let metadata: PowerPointContent["metadata"] = {
      totalSlides: 0,
    };

    // Parse slide files
    const slideFiles = directory.files.filter((f) => f.path.match(/ppt\/slides\/slide\d+\.xml$/));
    metadata.totalSlides = slideFiles.length;

    for (let i = 0; i < slideFiles.length; i++) {
      const slideFile = slideFiles[i];
      const content = await slideFile.buffer();
      const xmlContent = content.toString();
      const parsed = await parseStringPromise(xmlContent);

      // Extract text from shapes
      const shapes = parsed?.["p:sld"]?.["p:cSld"]?.[0]?.["p:spTree"]?.[0]?.["p:sp"] || [];
      let slideTitle = "";
      const bullets: string[] = [];
      const textContent: string[] = [];

      for (const shape of shapes) {
        const txBody = shape["p:txBody"]?.[0];
        if (!txBody) continue;

        const paragraphs = txBody["a:p"] || [];
        for (const para of paragraphs) {
          const runs = para["a:r"] || [];
          let paraText = "";

          for (const run of runs) {
            const text = run["a:t"]?.[0];
            if (text) {
              paraText += text;
            }
          }

          if (paraText) {
            textContent.push(paraText);
            const level = para["a:pPr"]?.[0]?.["$"]?.["lvl"] || "0";
            if (level === "0" && !slideTitle) {
              slideTitle = paraText;
              topics.add(paraText);
            } else {
              bullets.push(paraText);
            }
          }
        }
      }

      const slideText = textContent.join(" ");
      allText.push(slideText);

      slides.push({
        slideNumber: i + 1,
        title: slideTitle || undefined,
        text: slideText,
        bullets,
        images: [], // TODO: extract image references
        notes: undefined,
      });
    }

    return {
      metadata,
      slides,
      summary: {
        mainTopics: Array.from(topics).slice(0, 10),
        keyMessages: slides
          .slice(0, 5)
          .map((s) => s.title || s.text.substring(0, 100))
          .filter(Boolean),
        visualElements: slides.reduce((sum, s) => sum + s.images.length, 0),
        totalText: allText.join(" "),
      },
    };
  } catch (err) {
    // Fallback for simpler PPTX structure
    console.error("PowerPoint parsing error:", err);
    throw new Error(`Failed to parse PowerPoint: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
