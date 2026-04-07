import crypto from "crypto";

const kekHex = process.env.MASTER_ENCRYPTION_KEY ?? "";

if (kekHex.length !== 64) {
  // eslint-disable-next-line no-console
  console.warn("MASTER_ENCRYPTION_KEY should be 64 hex chars (32 bytes)");
}

export interface EncryptedField {
  ciphertext: string;
  encrypted_key: string;
  data_iv: string;
  key_iv: string;
}

const generateDEK = (): Buffer => crypto.randomBytes(32);

const encryptDEK = (dek: Buffer): { encryptedDEK: string; iv: string } => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(kekHex, "hex"),
    iv,
  );
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  return { encryptedDEK: encrypted.toString("hex"), iv: iv.toString("hex") };
};

const decryptDEK = (encryptedDEK: string, iv: string): Buffer => {
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(kekHex, "hex"),
    Buffer.from(iv, "hex"),
  );
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedDEK, "hex")),
    decipher.final(),
  ]);
};

export const encryptField = (plaintext: string): EncryptedField => {
  const dek = generateDEK();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", dek, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const wrapped = encryptDEK(dek);
  return {
    ciphertext: encrypted.toString("hex"),
    encrypted_key: wrapped.encryptedDEK,
    data_iv: iv.toString("hex"),
    key_iv: wrapped.iv,
  };
};

export const decryptField = (field: EncryptedField): string => {
  const dek = decryptDEK(field.encrypted_key, field.key_iv);
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    dek,
    Buffer.from(field.data_iv, "hex"),
  );
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(field.ciphertext, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
};
