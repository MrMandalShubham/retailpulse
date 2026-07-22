import { describe, expect, it } from "vitest";
import { mapEnvelopeToCleanProduct } from "../src/platform/oliveyoung-clean.js";

const ENVELOPE = {
  product_id: "GA260339051",
  source: "oliveyoung-global",
  source_url: "https://global.oliveyoung.com/product/detail?prdtNo=GA260339051",
  fetched_at: "2026-07-16T00:00:00.000Z",
  endpoints: {
    "detail-data": {
      product: {
        prdtNo: "GA260339051",
        prdtNameEn: "celimax  Retinal Shot  Booster",
        korPrdtName: "셀리맥스 레티날 샷",
        brandNo: "B00285",
        brandName: "celimax",
        korBrandName: "셀리맥스",
        gdsCd: "8809700321918",
        ctgrNo: "1000000015",
        allPathCtgrNameEn: "OliveYoungGlobal &gt; Skincare &gt; Moisturizers &gt; Essence & Serum",
        korAllPathCtgrName: "올리브영 &gt; 스킨케어",
        nrmlAmt: 24.0,
        saleAmt: 18.48,
        discountRate: 23.0,
        minCpnApplyAmt: 13.48,
        sellStatCode: "10",
        bestYn: "Y",
        newYn: "N",
        flashYn: "Y",
        sellingFastYn: "Y",
        releaseYmd: "20260324",
        imagePath: "prdtImg/1847/img.jpg",
        optionList: [{ rprstYn: "Y", buyStockQty: 973 }, { rprstYn: "N", buyStockQty: 10 }],
        thumbnailList: [{ imagePath: "a.jpg" }],
        promotion: { promoLabel: "SALE" },
        mbrGradeCpnMap: { "40": { cpnDscntAmt: 5 } },
      },
    },
    "details-info": {
      details: {
        dtlDesc: "&lt;div&gt;&lt;img src=&quot;x.jpg&quot;/&gt;&lt;/div&gt;",
        whyWeLoveItText: "Retinal firming.\r\n\r\nDeeper   penetration.",
        ftrdIngrdText: "Contains Micro A Shot&reg; retinal.",
        howToUseText: "Apply in the evening.",
      },
    },
    "review-summary": {
      totalStarRate: 4.7,
      totalReviewCount: 1356,
      totalMediaReviewCount: 526,
      scores: [{ star: 5, count: 1063 }],
      evltScores: [{ evltItemNm: "Moisturizing", rate: 4.5 }],
    },
  },
};

describe("mapEnvelopeToCleanProduct", () => {
  const row = mapEnvelopeToCleanProduct(ENVELOPE, "raw-doc-1")!;

  it("produces a clean, typed row (no raw or half-parsed values)", () => {
    expect(row).not.toBeNull();
    expect(row.productId).toBe("GA260339051");
    expect(row.barcode).toBe("8809700321918");
    expect(row.rawDocumentId).toBe("raw-doc-1");
    // text collapsed + trimmed
    expect(row.nameEn).toBe("celimax Retinal Shot Booster");
    expect(row.brandName).toBe("celimax");
    // entities decoded in the category path + split into levels
    expect(row.categoryPathEn).toBe("OliveYoungGlobal > Skincare > Moisturizers > Essence & Serum");
    expect(row.categoryL1).toBe("Skincare");
    expect(row.categoryL2).toBe("Moisturizers");
    expect(row.categoryL3).toBe("Essence & Serum");
    // numbers typed as fixed-2 strings
    expect(row.regularPrice).toBe("24.00");
    expect(row.salePrice).toBe("18.48");
    expect(row.discountRate).toBe("23.00");
    expect(row.currency).toBe("USD");
    // Y/N -> boolean
    expect(row.isBest).toBe(true);
    expect(row.isNew).toBe(false);
    // YYYYMMDD -> date
    expect(row.releaseDate).toBe("2026-03-24");
    // representative option stock
    expect(row.stockQty).toBe(973);
    // image CDN-prefixed
    expect(row.primaryImage).toBe("https://cdn-image.oliveyoung.com/prdtImg/1847/img.jpg");
    // reviews typed + clamped
    expect(row.reviewCount).toBe(1356);
    expect(row.avgRating).toBe("4.70");
    expect(row.mediaReviewCount).toBe(526);
  });

  it("decodes prose + html and preserves paragraph breaks", () => {
    expect(row.ingredients).toBe("Contains Micro A Shot® retinal.");
    expect(row.whyWeLoveIt).toBe("Retinal firming.\n\nDeeper penetration."); // \r\n normalized, spaces collapsed
    expect(row.descriptionHtml).toBe('<div><img src="x.jpg"/></div>'); // real HTML, decoded
  });

  it("keeps nested structured data as JSONB", () => {
    expect(row.options).toHaveLength(2);
    expect(row.starBreakdown).toEqual([{ star: 5, count: 1063 }]);
    expect(row.attributeScores).toEqual([{ evltItemNm: "Moisturizing", rate: 4.5 }]);
    expect(row.memberPricing).toEqual({ "40": { cpnDscntAmt: 5 } });
  });

  it("returns null when detail-data is missing (delisted / failed fetch)", () => {
    const failed = { product_id: "GA0", endpoints: { "detail-data": null } };
    expect(mapEnvelopeToCleanProduct(failed, null)).toBeNull();
  });
});
