/**
 * Base error class for all parser errors.
 * Consumers can catch `ParserError` to handle any parser failure.
 */
export class ParserError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ParserError";
  }
}

/**
 * Thrown when the input buffer is empty, too small, or not a valid PDF.
 */
export class InvalidPDFError extends ParserError {
  constructor(detail: string, options?: ErrorOptions) {
    super(`Invalid PDF: ${detail}`, options);
    this.name = "InvalidPDFError";
  }
}

/**
 * Thrown when the PDF was read successfully but does not match the expected
 * report format for the parser being used (e.g., passing a CreditXpert PDF
 * to the Xactus parser).
 */
export class UnrecognizedFormatError extends ParserError {
  /** The parser that rejected the document */
  public readonly parser: string;

  constructor(parser: string, detail: string, options?: ErrorOptions) {
    super(`Unrecognized format for ${parser} parser: ${detail}`, options);
    this.name = "UnrecognizedFormatError";
    this.parser = parser;
  }
}

/**
 * Thrown when the PDF matches the expected format but a required section
 * is missing or could not be parsed (e.g., no borrower info found).
 */
export class MissingSectionError extends ParserError {
  /** The parser that encountered the issue */
  public readonly parser: string;
  /** The section that was expected but not found */
  public readonly section: string;

  constructor(parser: string, section: string, options?: ErrorOptions) {
    super(`${parser}: required section "${section}" not found or empty`, options);
    this.name = "MissingSectionError";
    this.parser = parser;
    this.section = section;
  }
}

/**
 * Thrown when PDF text extraction fails (corrupt PDF, encrypted, etc.).
 */
export class ExtractionError extends ParserError {
  constructor(detail: string, options?: ErrorOptions) {
    super(`PDF extraction failed: ${detail}`, options);
    this.name = "ExtractionError";
  }
}
