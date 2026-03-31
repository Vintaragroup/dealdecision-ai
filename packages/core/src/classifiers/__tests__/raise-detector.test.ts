import { containsMarketSizingLanguage, inferIsRaiseAskSlide } from "../raise-detector";

describe("inferIsRaiseAskSlide", () => {
	test("$8B TAM -> false", () => {
		expect(inferIsRaiseAskSlide("$8B TAM")).toBe(false);
	});

	test("market sizing language detection covers common phrases", () => {
		expect(containsMarketSizingLanguage("Total Addressable Market (TAM)")).toBe(true);
		expect(containsMarketSizingLanguage("Serviceable Addressable Market")).toBe(true);
	});

	test("market is/= $X patterns are market sizing", () => {
		expect(containsMarketSizingLanguage("The market is $8B")).toBe(true);
		expect(containsMarketSizingLanguage("Market = $2.5B")).toBe(true);
	});

	test("The Ask: raising $2M via SAFE -> true", () => {
		expect(inferIsRaiseAskSlide("The Ask: raising $2M via SAFE")).toBe(true);
	});

	test("Raising $2M in a $8B market -> true", () => {
		expect(inferIsRaiseAskSlide("Raising $2M in a $8B market")).toBe(true);
	});

	test("$2M market opportunity (no ask language) -> false", () => {
		expect(inferIsRaiseAskSlide("$2M market opportunity")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Regression: advisor historical "raise" context must not trigger the detector
// ---------------------------------------------------------------------------
describe("inferIsRaiseAskSlide — advisor history guard (upstream data fix)", () => {
	test("'helped companies raise $2B' is NOT a raise ask slide", () => {
		expect(inferIsRaiseAskSlide("John Smith helped companies raise $2B in value.")).toBe(false);
	});

	test("'helped raise $500M for portfolio' is NOT a raise ask slide", () => {
		expect(inferIsRaiseAskSlide("Our team helped raise $500M for portfolio companies.")).toBe(false);
	});

	test("'helps companies raising capital' is still a raise slide when explicit ask present", () => {
		// "raising" + "$5M" — the seek is explicit for THIS company.
		expect(inferIsRaiseAskSlide("We are raising $5M in our seed round.")).toBe(true);
	});

	test("seek anchor still works without 'helped' prefix", () => {
		expect(inferIsRaiseAskSlide("Seeking $3M to accelerate go-to-market.")).toBe(true);
	});
});
describe("inferIsRaiseAskSlide — B2B abbreviation false-positive guard", () => {
        test("'B2B technology services' does not produce a raise signal near 'equity'", () => {
                // "B2B" tokenizes as ["b", "2b"] where "2b" would otherwise look like $2 billion.
                // With the B2B guard, "2b" preceded by a single letter "b" is not a money token.
                const text = "Our advisors bring experience in equity and credit capital, consumer goods and B2B technology services.";
                expect(inferIsRaiseAskSlide(text)).toBe(false);
        });

        test("explicit '$2B' raise (with dollar sign) is still a money token", () => {
                // "$2B" always has the explicit $ prefix — the B2B guard must NOT affect it.
                expect(inferIsRaiseAskSlide("We are raising $2B in our Series C.")).toBe(true);
        });

        test("'created over $2B in value' on advisor page does not trigger raise signal", () => {
                // Vermont-style: advisor page mentions "equity", "B2B", "$2B in value" and "raise capital".
                // The B2B guard removes the "2b" false money token. The real "$2B" (explicit $) is 100+
                // tokens away from "raise capital" in the actual multi-column OCR text — so no signal.
                // We simulate the long inter-column distance with padding between the two phrases.
                const padding = "bio text about skills and experience at various distilleries over many decades including board roles leadership and M&A expertise across consumer goods and technology sectors as well as diverse background consulting";
                const text =
                        "Our Advisors bring experience in equity and credit capital consumer goods and B2B technology services. " +
                        "Darr served as CEO of Vermont Spirits from 2019-2024 which created over $2B in value. " +
                        padding + " " + padding + " " +
                        "Daniela is also a CPA. source deals, raise capital and provide value to dealmakers.";
                expect(inferIsRaiseAskSlide(text)).toBe(false);
        });

        test("B2C abbreviation similarly does not produce a raise signal", () => {
                const text = "Our advisors have deep experience in B2C consumer markets and equity investing.";
                expect(inferIsRaiseAskSlide(text)).toBe(false);
        });
});