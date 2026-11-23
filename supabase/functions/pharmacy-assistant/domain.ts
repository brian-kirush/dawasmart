export type AssistantIntent =
  | "low_stock"
  | "expiry"
  | "recommendations"
  | "sales"
  | "forecast"
  | "greeting"
  | "gratitude"
  | "medicine_info"
  | "clinical"
  | "general";

export type MedicineQuestion = {
  medicine: string;
  topic:
    | "indications_and_usage"
    | "adverse_reactions"
    | "storage_and_handling"
    | "drug_interactions";
};

export function intentFor(question: string): AssistantIntent {
  const text = question.toLowerCase();
  if (
    /^(hi|hello|hey|good morning|good afternoon|good evening)[!. ]*$/i.test(
      question.trim(),
    )
  ) {
    return "greeting";
  }
  if (
    /^(thanks|thank you|thanks a lot|thank you so much|much appreciated)[!. ]*$/i
      .test(question.trim())
  ) {
    return "gratitude";
  }
  if (
    /\b(i have|i am|i'm|my symptoms|my medication|my medicine|my drug|my child|my baby|pregnant|pregnancy|breastfeeding|took|taking|should i take|can i take|should i stop|can i use|what dose|dosage|diagnos|symptoms?|patient-specific|dose for|emergency|treat my|for my|for me|in my case|is it safe for me|can someone with|can a person with|if you have)\b/i
      .test(text)
  ) {
    return "clinical";
  }
  if (extractMedicineQuestion(question)) return "medicine_info";
  if (/expir|expiry|expire|shelf life/i.test(text)) return "expiry";
  if (/recommend|reorder|purchase|supplier|order/i.test(text)) {
    return "recommendations";
  }
  if (/sale|sell|receipt|revenue|transaction/i.test(text)) return "sales";
  if (/forecast|demand|predict|model/i.test(text)) return "forecast";
  if (/stock|inventory|low|out of stock|batches/i.test(text)) {
    return "low_stock";
  }
  if (
    /\b(medicine|medication|drug|health|disease|condition|treatment|medical|patient|diagnosis|dosage|dose|pregnant|pregnancy|child|baby|safe|okay|interact|side effects?|adverse effects?|taking|take)\b/i
      .test(text)
  ) {
    return "clinical";
  }
  return "general";
}

export function extractMedicineQuestion(
  question: string,
): MedicineQuestion | null {
  const patterns: Array<{
    pattern: RegExp;
    topic: MedicineQuestion["topic"];
  }> = [
    {
      pattern:
        /^(?:what are )?(?:the )?(?:common )?(?:side effects|adverse effects) of (.+?)\??$/i,
      topic: "adverse_reactions",
    },
    {
      pattern: /^(?:what are )?(?:the )?(?:known )?interactions of (.+?)\??$/i,
      topic: "drug_interactions",
    },
    {
      pattern: /^what does (.+?) interact with\??$/i,
      topic: "drug_interactions",
    },
    {
      pattern: /^(?:what are )?(?:the )?(?:common )?uses of (.+?)\??$/i,
      topic: "indications_and_usage",
    },
    {
      pattern: /^what is (.+?) used for\??$/i,
      topic: "indications_and_usage",
    },
    {
      pattern: /^what is (.+?) for\??$/i,
      topic: "indications_and_usage",
    },
    {
      pattern: /^what is (.+?)\??$/i,
      topic: "indications_and_usage",
    },
    {
      pattern: /^tell me about (.+?)\??$/i,
      topic: "indications_and_usage",
    },
    {
      pattern: /^how (?:should|do) (?:i )?store (.+?)\??$/i,
      topic: "storage_and_handling",
    },
    {
      pattern: /^storage (?:advice|information) for (.+?)\??$/i,
      topic: "storage_and_handling",
    },
  ];

  for (const { pattern, topic } of patterns) {
    const match = question.trim().match(pattern);
    if (!match) continue;
    const medicine = match[1].trim().replace(/[?.!,;:]+$/, "").trim();
    if (
      medicine.length > 80 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9 ./'-]*$/.test(medicine)
    ) return null;
    return { medicine, topic };
  }
  return null;
}
