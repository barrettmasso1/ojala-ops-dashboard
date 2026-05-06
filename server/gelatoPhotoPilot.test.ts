import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  storagePut: vi.fn(),
}));

const llmMocks = vi.hoisted(() => ({
  invokeLLM: vi.fn(),
}));

vi.mock("./storage", () => storageMocks);
vi.mock("./_core/llm", () => llmMocks);

import {
  buildGroupedGelatoEntries,
  extractGelatoPhotos,
  normalizeSinglePanPhotoCounts,
  type ExtractedGelatoPhoto,
} from "./gelatoPhotoPilot";

describe("normalizeSinglePanPhotoCounts", () => {
  it("defaults any single detected pan to the small-pan workflow while preserving valid same-size two-pan reads", () => {
    expect(normalizeSinglePanPhotoCounts({ smallPanCount: 0, largePanCount: 1 })).toEqual({
      smallPanCount: 1,
      largePanCount: 0,
    });
    expect(normalizeSinglePanPhotoCounts({ smallPanCount: 1, largePanCount: 0 })).toEqual({
      smallPanCount: 1,
      largePanCount: 0,
    });
    expect(normalizeSinglePanPhotoCounts({ smallPanCount: 2, largePanCount: 0 })).toEqual({
      smallPanCount: 2,
      largePanCount: 0,
    });
    expect(normalizeSinglePanPhotoCounts({ smallPanCount: 0, largePanCount: 2 })).toEqual({
      smallPanCount: 0,
      largePanCount: 2,
    });
    expect(normalizeSinglePanPhotoCounts({ smallPanCount: 1, largePanCount: 1 })).toEqual({
      smallPanCount: 1,
      largePanCount: 1,
    });
  });
});

describe("buildGroupedGelatoEntries", () => {
  it("groups same-flavor single-pan and combined small-plus-large photos by flavor", () => {
    const extractedPhotos: ExtractedGelatoPhoto[] = [
      {
        fileName: "vanilla-pair.jpg",
        imageUrl: "/manus-storage/one",
        imageKey: "gelato/one.jpg",
        flavor: "Vanilla",
        smallPanCount: 1,
        largePanCount: 1,
        combinedGrossWeightKg: 3.95,
        confidence: "high",
        warning: "",
      },
      {
        fileName: "vanilla-large.jpg",
        imageUrl: "/manus-storage/two",
        imageKey: "gelato/two.jpg",
        flavor: "Vanilla",
        smallPanCount: 0,
        largePanCount: 1,
        combinedGrossWeightKg: 3.42,
        confidence: "high",
        warning: "",
      },
      {
        fileName: "chocolate-small.jpg",
        imageUrl: "/manus-storage/three",
        imageKey: "gelato/three.jpg",
        flavor: "Chocolate",
        smallPanCount: 1,
        largePanCount: 0,
        combinedGrossWeightKg: 1.52,
        confidence: "medium",
        warning: "",
      },
    ];

    expect(buildGroupedGelatoEntries(extractedPhotos)).toEqual([
      {
        flavor: "Chocolate",
        smallPanCount: 1,
        largePanCount: 0,
        combinedGrossWeightKg: 1.52,
      },
      {
        flavor: "Vanilla",
        smallPanCount: 1,
        largePanCount: 2,
        combinedGrossWeightKg: 7.37,
      },
    ]);
  });

  it("ignores unreadable photos until a user corrects them", () => {
    const extractedPhotos: ExtractedGelatoPhoto[] = [
      {
        fileName: "unclear.jpg",
        imageUrl: "/manus-storage/five",
        imageKey: "gelato/five.jpg",
        flavor: "Unknown flavor",
        smallPanCount: 0,
        largePanCount: 0,
        combinedGrossWeightKg: 0,
        confidence: "low",
        warning: "Scale display was not fully readable.",
      },
      {
        fileName: "mint-chip.jpg",
        imageUrl: "/manus-storage/six",
        imageKey: "gelato/six.jpg",
        flavor: "Mint Chip",
        smallPanCount: 1,
        largePanCount: 0,
        combinedGrossWeightKg: 1.11,
        confidence: "medium",
        warning: "",
      },
    ];

    expect(buildGroupedGelatoEntries(extractedPhotos)).toEqual([
      {
        flavor: "Mint Chip",
        smallPanCount: 1,
        largePanCount: 0,
        combinedGrossWeightKg: 1.11,
      },
    ]);
  });
});

describe("extractGelatoPhotos", () => {
  beforeEach(() => {
    storageMocks.storagePut.mockReset();
    llmMocks.invokeLLM.mockReset();
  });

  it("sends the uploaded data URL directly to image analysis while keeping the storage URL for preview", async () => {
    storageMocks.storagePut.mockResolvedValue({
      key: "gelato-photo-pilot/test-image.jpg",
      url: "/manus-storage/gelato-photo-pilot/test-image.jpg",
    });

    llmMocks.invokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              flavor: "Peanut Butter",
              small_pan_count: 1,
              large_pan_count: 0,
              gross_weight_kg: 2.35,
              confidence: "medium",
              warning: "",
            }),
          },
        },
      ],
    });

    const dataUrl = "data:image/jpeg;base64,ZmFrZS1pbWFnZQ==";
    const result = await extractGelatoPhotos([
      {
        fileName: "test.jpg",
        mimeType: "image/jpeg",
        dataUrl,
      },
    ]);

    expect(storageMocks.storagePut).toHaveBeenCalledTimes(1);
    expect(llmMocks.invokeLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "image_url",
                image_url: expect.objectContaining({
                  url: dataUrl,
                }),
              }),
            ]),
          }),
        ]),
      })
    );
    expect(result.extractedPhotos[0]).toMatchObject({
      imageUrl: "/manus-storage/gelato-photo-pilot/test-image.jpg",
      imageKey: "gelato-photo-pilot/test-image.jpg",
      flavor: "Peanut Butter",
      smallPanCount: 1,
      largePanCount: 0,
      combinedGrossWeightKg: 2.35,
    });
  });
});
