import { detectContentArchetypeTags } from "../content-archetypes";

describe("detectContentArchetypeTags", () => {
  test("tags medical education", () => {
    const tags = detectContentArchetypeTags({
      title: "Effects of lead exposure on children",
      snippet: "Symptoms include abdominal pain, vomiting, constipation; prevention and treatment guidance.",
      ocr: null,
      structured: null,
    });
    expect(tags).toContain("medical_education");
  });

  test("tags product how-it-works when anchored", () => {
    const tags = detectContentArchetypeTags({
      title: "How it works",
      snippet: "Our platform workflow: connect the API, authenticate via OAuth, and automate compliance checks end-to-end.",
      ocr: null,
      structured: null,
    });
    expect(tags).toContain("product_how_it_works");
  });

  test("tags market overview only with strong anchors", () => {
    const tags = detectContentArchetypeTags({
      title: "Market size",
      snippet: "TAM $12B, SAM $3B, CAGR 18% through 2030.",
      ocr: null,
      structured: null,
    });
    expect(tags).toContain("market_overview");
  });

  test("tags real estate lease terms", () => {
    const tags = detectContentArchetypeTags({
      title: "Lease Terms",
      snippet: "NNN lease; remaining term 12 years; occupancy 98%; rent roll and PSF details.",
      ocr: null,
      structured: null,
    });
    expect(tags).toContain("real_estate_lease_terms");
  });

  test("tags capital stack when fundraising anchored", () => {
    const tags = detectContentArchetypeTags({
      title: "Sources & Uses",
      snippet: "Capital stack: equity and debt; uses of funds. Term sheet and valuation cap details. IRR and MOIC shown.",
      ocr: null,
      structured: null,
    });
    expect(tags).toContain("capital_stack");
  });
});
