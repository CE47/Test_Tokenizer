/* =============================================================================
 * content.js — sample texts, glossary, model catalogue, pricing.
 * ========================================================================== */
(function (global) {
  "use strict";

  var SAMPLES = [
    {
      id: "hello",
      label: "Hello, world!",
      text: "Hello, world!"
    },
    {
      id: "tokens",
      label: "How many tokens?",
      text: "Tokenizers are the unsung heroes of large language models."
    },
    {
      id: "space",
      label: "Leading spaces",
      text: "cat  cat   cat    cat"
    },
    {
      id: "numbers",
      label: "Numbers",
      text: "Call 1-800-555-0199 at 12:34 on 2026-10-11 for $1,234,567.89"
    },
    {
      id: "code",
      label: "Code",
      text: "def greet(name):\n    return f\"Hello, {name}!\""
    },
    {
      id: "json",
      label: "JSON",
      text: '{\"model\":\"gpt-4o\",\"max_tokens\":128,\"temperature\":0.7}'
    },
    {
      id: "accent",
      label: "Accented text",
      text: "élève café naïve — résumé"
    },
    {
      id: "emoji",
      label: "Emoji",
      text: "Ship it 🚀🎉💡"
    },
    {
      id: "cjk",
      label: "中文 / 日本語",
      text: "你好，世界！こんにちは世界"
    },
    {
      id: "arabic",
      label: "العربية / עברית",
      text: "مرحبا بالعالم שלום עולם"
    },
    {
      id: "devanagari",
      label: "Devanagari",
      text: "क्ष कैले में कत्ा चाहें"
    },
    {
      id: "long",
      label: "Rare word",
      text: "Antidisestablishmentarianism supercalifragilisticexpialidocious"
    },
    {
      id: "caps",
      label: "SHOUTING",
      text: "THIS IS SHOUTING AND this is not"
    },
    {
      id: "special",
      label: "Special token",
      text: "One moment<|endoftext|>and another"
    },
    {
      id: "prose",
      label: "A paragraph",
      text:
        "A language model never sees your words. It sees a list of integers, " +
        "and every one of those integers was chosen by a greedy merge algorithm " +
        "that ran over a giant pile of text, once, before the model was ever trained."
    }
  ];

  var MODELS = [
    { name: "gpt-4o", enc: "o200k_base", ctx: 128000, in: 2.5, out: 10 },
    { name: "gpt-4o-mini", enc: "o200k_base", ctx: 128000, in: 0.15, out: 0.6 },
    { name: "gpt-4.1", enc: "o200k_base", ctx: 1047576, in: 2, out: 8 },
    { name: "gpt-4.1-mini", enc: "o200k_base", ctx: 1047576, in: 0.4, out: 1.6 },
    { name: "gpt-4-turbo", enc: "cl100k_base", ctx: 128000, in: 10, out: 30 },
    { name: "gpt-4", enc: "cl100k_base", ctx: 8192, in: 30, out: 60 },
    { name: "gpt-3.5-turbo", enc: "cl100k_base", ctx: 16385, in: 0.5, out: 1.5 },
    { name: "text-embedding-3-small", enc: "cl100k_base", ctx: 8191, in: 0.02, out: 0 },
    { name: "text-embedding-3-large", enc: "cl100k_base", ctx: 8191, in: 0.13, out: 0 },
    { name: "davinci-002 (legacy)", enc: "cl100k_base", ctx: 4096, in: 0.02, out: 0.02 },
    { name: "GPT-2 / GPT-3", enc: "r50k_base", ctx: 1024, in: 0, out: 0 }
  ];

  var GLOSSARY = [
    {
      term: "Token",
      short: "The unit a model actually reads and writes.",
      long:
        "A token is a row in a fixed lookup table. It might be a whole word, part " +
        "of a word, a single character, a chunk of digits, a piece of emoji, or " +
        "even a leading space. The model has no concept of letters — it only " +
        "ever sees these integers."
    },
    {
      term: "Token ID",
      short: "The integer that stands in for a token.",
      long:
        "Every token in the vocabulary has a unique number. cl100k_base has " +
        "100,277 of them (0–100,255 mergeable plus a few reserved 'special' ones). " +
        "Your prompt becomes a list like [9906, 11, 1917, 0]."
    },
    {
      term: "Vocabulary / merge table",
      short: "Every token the model knows, and how eagerly it merges pairs.",
      long:
        "Built once, offline, by running byte-pair encoding over a huge corpus of " +
        "web text. The result is a ranked list where a lower rank means 'merge " +
        "these two pieces earlier', i.e. the pair is more common in real text. " +
        "This is the actual data OpenAI ships for cl100k_base and o200k_base."
    },
    {
      term: "Byte",
      short: "8 bits. The only alphabet every tokenizer starts from.",
      long:
        "Text is first encoded as UTF-8. One character can be 1 to 4 bytes " +
        "('a' = 1 byte, 'é' = 2, '€' = 3, '🚀' = 4). Because every possible byte " +
        "value 0–255 is itself a token, no input can ever be unrepresentable."
    },
    {
      term: "BPE — Byte Pair Encoding",
      short: "Repeatedly glue the most common adjacent pair.",
      long:
        "Start with every byte as its own piece. Then, over and over, find the " +
        "adjacent pair whose merge has the lowest rank and glue it. Stop when no " +
        "mergeable pair is left. Common sequences collapse into single tokens; " +
        "rare ones stay split into fragments."
    },
    {
      term: "Pre-token",
      short: "The chunk BPE is allowed to work on.",
      long:
        "Before merging, a regex cuts the text into blocks so BPE never merges " +
        "across a boundary it shouldn't — like spanning two words, or a letter " +
        "and a digit. This is why ' 123' and '123' cost different numbers of tokens."
    },
    {
      term: "Rank",
      short: "A token's merge priority. Lower = merged earlier = more common.",
      long:
        "Ranks 0–255 are always the raw bytes. From 256 upward, each rank is one " +
        "learned merge. The rank is the number you see in this app's inspectors."
    },
    {
      term: "Special token",
      short: "A reserved id that means something structural, not literal text.",
      long:
        "Things like the end-of-text marker are not produced by BPE at all — they " +
        "are reserved ids the model was trained to understand as control signals."
    },
    {
      term: "Context window",
      short: "How many tokens the model can hold at once.",
      long:
        "Prompt + reply must fit. Overshooting is an error. This is why chat " +
        "models usually spend their budget on instructions before you type a word."
    },
    {
      term: "Embedding",
      short: "The vector a token id turns into.",
      long:
        "A token id is a row index into a giant learned table. The row is a " +
        "high-dimensional vector (1536 numbers in GPT-4o's case) that encodes " +
        "what the model has learned about how that token behaves in context."
    },
    {
      term: "Attention",
      short: "How each token decides which other tokens matter to it.",
      long:
        "Every token computes a query, compares it to every earlier token's key, " +
        "and mixes their values in proportion to the match. This is how the word " +
        "'it' on line 40 can find the noun it refers to on line 2."
    },
    {
      term: "Logit",
      short: "A raw, unnormalised score for 'this is the next token'.",
      long:
        "The model ends every forward pass by scoring all ~100k tokens and " +
        "picking one. Temperature and top-p then reshape those scores before a " +
        "token is sampled."
    },
    {
      term: "Detokenisation",
      short: "Turning ids back into text.",
      long:
        "Each id maps back to its bytes; concatenate the bytes and decode as " +
        "UTF-8. Concatenation is byte-wise, so a multi-byte character can be " +
        "split across two tokens — visible in this app as half an emoji."
    }
  ];

  var ENCODINGS = [
    {
      id: "cl100k_base",
      label: "cl100k_base",
      note: "GPT-4 · GPT-3.5-turbo · text-embedding-3",
      vocab: 100277
    },
    {
      id: "o200k_base",
      label: "o200k_base",
      note: "GPT-4o · GPT-4.1 · GPT-5",
      vocab: 200019
    },
    {
      id: "r50k_base",
      label: "r50k_base",
      note: "GPT-2 · GPT-3 davinci/curie/babbage",
      vocab: 50257
    },
    {
      id: "p50k_base",
      label: "p50k_base",
      note: "text-davinci-002/003 · code-davinci-002",
      vocab: 50257
    }
  ];

  global.Content = {
    SAMPLES: SAMPLES,
    MODELS: MODELS,
    GLOSSARY: GLOSSARY,
    ENCODINGS: ENCODINGS
  };
})(typeof window !== "undefined" ? window : globalThis);