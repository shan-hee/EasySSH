import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export class Validator {
  private static ajv: Ajv | null = null;

  static getInstance(): Ajv {
    if (!this.ajv) {
      const ajv = new Ajv({
        allErrors: true,
        coerceTypes: true,
        allowUnionTypes: true,
        removeAdditional: 'failing'
      });
      addFormats(ajv);
      this.ajv = ajv;
    }
    return this.ajv;
  }
}

