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
