declare module 'qrcode' {
  interface QrOptions {
    errorCorrectionLevel?: 'L'|'M'|'Q'|'H';
    margin?: number;
    width?: number;
    color?: {dark?:string;light?:string};
  }
  const QRCode: {
    toDataURL(value:string, options?:QrOptions):Promise<string>;
  };
  export default QRCode;
}
