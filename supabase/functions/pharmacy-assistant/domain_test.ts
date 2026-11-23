import { extractMedicineQuestion, intentFor } from "./domain.ts";

Deno.test("general medicine questions are grounded in the label flow", () => {
  const question = "What are common side effects of amoxicillin?";
  if (intentFor(question) !== "medicine_info") {
    throw new Error("Expected medication information intent.");
  }
  const extracted = extractMedicineQuestion(question);
  if (
    extracted?.medicine !== "amoxicillin" ||
    extracted.topic !== "adverse_reactions"
  ) {
    throw new Error("Expected the active ingredient and label topic.");
  }
});

Deno.test("patient-specific medicine questions are refused", () => {
  if (intentFor("Can I take ibuprofen for my headache?") !== "clinical") {
    throw new Error("Expected a patient-specific question to be refused.");
  }
  if (
    intentFor("Can my medication interact with ibuprofen?") !== "clinical"
  ) {
    throw new Error("Expected a personal medication question to be refused.");
  }
  if (intentFor("Is ibuprofen safe?") !== "clinical") {
    throw new Error("Expected unsupported safety questions to be refused.");
  }
});

Deno.test("pharmacy inventory questions keep their operational intent", () => {
  if (intentFor("Which medicines are low in stock?") !== "low_stock") {
    throw new Error("Expected an inventory question to use pharmacy facts.");
  }
});

Deno.test("medicine terms outside supported question forms are not improvised", () => {
  if (intentFor("How do I treat a cough with medicine?") !== "clinical") {
    throw new Error("Expected unsupported medical advice to be refused.");
  }
});
