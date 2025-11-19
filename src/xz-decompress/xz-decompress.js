/*!
 * This is a copy of the compiled output of the xz-decompress NPM package.
 * https://github.com/httptoolkit/xz-decompress/ License MIT
 *
 * That codebase in turn had these citations
 * Based on xzwasm (c) Steve Sanderson. License: MIT - https://github.com/SteveSanderson/xzwasm
 * Contains xz-embedded by Lasse Collin and Igor Pavlov. License: Public domain - https://tukaani.org/xz/embedded.html
 * and walloc (c) 2020 Igalia, S.L. License: MIT - https://github.com/wingo/walloc
 */
;(function webpackUniversalModuleDefinition(root, factory) {
  if (typeof exports === 'object' && typeof module === 'object')
    module.exports = factory(require('stream/web'))
  else if (typeof define === 'function' && define.amd)
    define(['stream/web'], factory)
  else if (typeof exports === 'object')
    exports['xz-decompress'] = factory(require('stream/web'))
  else root['xz-decompress'] = factory(root['stream/web'])
})(this, __WEBPACK_EXTERNAL_MODULE__2__ => {
  return /******/ (() => {
    // webpackBootstrap
    /******/ 'use strict'
    /******/ var __webpack_modules__ = [
      ,
      /* 0 */ /* 1 */
      /***/ module => {
        module.exports =
          'data:application/wasm;base64,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ACABQX9qIgENAAsgAkJ/hSECCyACC8oQAgx/An4CQAJAIAAoAiRFDQAgACgCACECDAELQQAhAiAAQQA6ACggAEIANwMAIABCADcDGCAAQcgAakEAQeQAEIaAgIAAGiAAQawBakEMNgIACyAAIAEoAgQiAzYCECAAQeAAaiEEIABByABqIQUgAEG2AWohBiAAQbABaiEHIABBqAFqIQggASgCECEJAkACQAJAAkADQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQCACDgoBAgAEBQYHCAkKDwsgASgCACEKIAAoAqgBIQIgACgCrAEhCyABKAIEIQwgASgCCCENDAILIAcgACgCqAEiDGogASgCACABKAIEIgJqIAEoAgggAmsiAiAAKAKsASAMayIMIAIgDEkbIgIQh4CAgAAaIAEgASgCBCACajYCBEEAIQwgAEEAIAAoAqgBIAJqIgIgAiAAKAKsASILRhs2AqgBIAIgC0cNESAAQQE2AgACQCAHQaiIgIAAQQYQhICAgABFDQBBBSEMDBILIAZBAkEAEI2AgIAAIAAoALgBRw0QQQYhDCAGLQAADREgACAALQC3ASICNgIgIAJBBEsNEUEBIAJ0QRNxRQ0RCyABKAIEIgwgASgCCCINRg0OAkAgASgCACIKIAxqLQAAIgsNACAAIAw2AhAgASAMQQFqNgIEQQYhAgwMC0EAIQIgAEEANgKoASAAQQI2AgAgACALQQJ0QQRqIgs2AqwBIAAgCzYCQAsgByACaiAKIAxqIA0gDGsiDCALIAJrIgIgDCACSRsiAhCHgICAABogASABKAIEIAJqNgIEQQAhDCAAQQAgACgCqAEgAmoiAiACIAAoAqwBIgtGGzYCqAEgAiALRw0PIAAgAkF8aiICNgKsAUEHIQwgByACQQAQjYCAgAAgByAAKAKsASICaigAAEcNDyAAQQI2AqgBIAAtALEBIgtBP3ENDAJAAkAgC0HAAHFFDQAgACAHIAggAhCRgICAAEEBRw0RIAAgACkDCDcDMCAAKAKsASECIAAtALEBIQsMAQsgAEJ/NwMwC0J/IQ4CQCALwEF/Sg0AIAAgByAIIAIQkYCAgABBAUcNECAAKAKsASECIAApAwghDgsgACAONwM4IAIgACgCqAEiC2tBAkkNDyAAIAtBAWoiCjYCqAEgCCALakEI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AA8LIAEgA0EBaiIFNgIEAkAgASgCACADai0AACAAKQMYIAAoAgQiA62Ip0H/AXFGDQBBBw8LIAAgA0EIaiIGNgIEIAUhAyAGIAJJDQALIABBADYCBCAAQgA3AxhBAQtvAQF/QQchAQJAIABBugFqLwAAQdm0AUcNACAAQbQBakEGQQAQjYCAgAAgAEGwAWooAABHDQAgAEGAAWopAwBCAoggADUAtAFSDQAgAEG4AWotAAANAEEBQQcgACgCICAAQbkBai0AAEYbIQELIAELwAIBA38CQAJAAkAgACgCJA0AIABBADoAKCAAQQA2AgBBASECDAELAkAgACgCAEEKRw0AQQAhAwwCC0ECIQMMAQtBASEDCwJAAkADQAJAAkACQAJAIAMOAwABAwMLIAEoAgQiAyABKAIIIgRGDQQgASgCACEFAkADQCAFIANqLQAADQEgASADQQFqIgM2AgQgACAAKAIEQQFqQQNxNgIEIAQgA0YNBgwACwsCQCAAKAIERQ0AQQcPCyAAKAIkRQ0BIABBADoAKCAAQQA2AgBBASEDDAMLIABCADcDGCAAQQA2AgQgAEHIAGpBAEHkABCGgICAABogAEGsAWpBDDYCAAtBAiEDDAELIAAgARCQgICAACIDQQFHDQIgAEEKNgIAQQAhAwwACwsCQCACDQBBAA8LQQdBASAAKAIEGyEDCyADC3UBAX8CQEG4CRCAgICAACICRQ0AIAIgADYCJCACIAAgARCbgICAACIANgKwCQJAIABFDQAgAkEAOgAoIAJCADcDACACQgA3AxggAkHIAGpBAEHkABCGgICAABogAkGsAWpBDDYCACACDwsgAhCCgICAAAtBAAseAAJAIABFDQAgACgCsAkQnYCAgAAgABCCgICAAAsL3RABCn8gAEHo3QFqIQIgAEHUAGohAyAAQRxqIgRBCGohBQJAAkADQCAAKAJAIQYCQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkAgASgCBCIHIAEoAghJDQAgBkEHRg0BDBELIAYOCQECAwQFBgcACQ4LIAAoAkwhBgwHC0EBIQYgASAHQQFqNgIEIAEoAgAgB2otAAAiB0UNCAJAAkAgB0HfAUsNACAHQQFHDQELIABBgAI7AVACQCAAKAI8DQAgACABKAIMIAEoAhAiBmo2AhggACABKAIUIAZrNgIsCyAEQgA3AgAgBUIANwIADAoLIAAtAFBFDQkMDQsgASAHQQFqNgIEIAEoAgAgB2otAAAhByAAQQI2AkAgACAHQQh0IAAoAkhqNgJIDAsLIAEgB0EBajYCBCABKAIAIAdqLQAAIQcgAEEDNgJAIAAgByAAKAJIakEBajYCSAwKCyABIAdBAWo2AgQgASgCACAHai0AACEHIABBBDYCQCAAIAdBCHQ2AkwMCQsgASAHQQFqNgIEIAEoAgAgB2otAAAhByAAIAAoAkQ2AkAgACAHIAAoAkxqQQFqNgJMDAgLIAEgB0EBajYCBEEHIQYgASgCACAHai0AACIHQeABSw0DQQAhCAJAAkAgB0EtTw0AQQAhCQwBCyAHQVNqIgcgB0H/AXFBLW4iCUEtbGshByAJQQFqIQkLIABBfyAJdEF/czYCdAJAIAdB/wFxQQlJDQAgB0F3aiIHIAdB/wFxQQluIghBCWxrIQcgCEEBaiEICyAAIAg2AnAgACAHQf8BcSIHNgJsIAggB2pBBEsNAyADQgA3AgAgA0EIakIANwIAIANBEGpBADYCACAAQX8gCHRBf3M2AnBB+AAhBwNAIAAgB2pBgAg7AQAgB0ECaiIHQeTdAUcNAAsgAEEGNgJAIABBBTYCCCAAQv////8PNwIACyAAKAJMIgpBBUkNBwJAIAAoAggiB0UNACAHQX9qIQYgASgCBCEHIAEoAgghCQNAIAkgB0YNCiABIAdBAWoiCDYCBCABKAIAIAdqLQAAIQcgACAGNgIIIAAgByAAKAIEQQh0cjYCBCAIIQcgBkF/aiIGQX9HDQALCyAAQQc2AkAgACAKQXtqIgY2AkwLIAAgACgCICIHIAEoAhQgASgCEGsiCCAAKAJIIgkgCCAJSRsiCGogACgCLCIJIAkgB2sgCEsbNgIoIAEoAggiCiABKAIEIghrIQcCQAJAAkAgACgC5N0BIgkNACAGDQFBACEGCyACIAlqIAEoAgAgCGpBKiAJayIIIAYgCWsiBiAIIAZJGyIGIAcgBiAHSRsiBxCHgICAABoCQAJAIAAoAuTdASIIIAdqIgYgACgCTEcNACACIAhqIAdqQQBBPyAGaxCGgICAABogACgC5N0BIAdqIQYMAQsCQCAGQRRLDQAgACAGNgLk3QEgASABKAIEIAdqNgIEDAMLIAZBa2ohBgsgAEEANgIQIAAgAjYCDCAAIAY2AhRBByEGIAAQmoCAgABFDQMgACgCECIIIAAoAuTdASIJIAdqSw0DIAAgACgCTCAIayIGNgJMAkAgCCAJTw0AIAAgCSAIayIHNgLk3QEgAiACIAhqIAcQhYCAgAAaDAILIABBADYC5N0BIAEgASgCBCAIIAlraiIINgIEIAEoAggiCiAIayEHCwJAIAdBFUkNACAAIAg2AhAgACABKAIANgIMIAAgCkFraiAIIAZqIAcgBkEVakkbNgIUQQchBiAAEJqAgIAARQ0DIAAoAkwiByAAKAIQIgggASgCBGsiCUkNAyABIAg2AgQgACAHIAlrIgY2AkwgASgCCCAIayIHQRRLDQELIAIgASgCACAIaiAHIAYgByAGSRsiBxCHgICAABogACAHNgLk3QEgASABKAIEIAdqNgIECyAAKAIgIgYgACgCHCIIayEHAkAgACgCPEUNAAJAIAYgACgCLEcNACAAQQA2AiALIAEoAgwgASgCEGogACgCGCAIaiAHEIeAgIAAGiAAKAIgIQYLIAAgBjYCHCABIAEoAhAgB2oiCDYCECAAIAAoAkgiBiAHazYCSAJAIAYgB0cNAEEHIQYgACgCTA0CIAAoAmgNAiAAKAIEDQIgAEEANgJADAQLQQAhBiAIIAEoAhRGDQEgASgCBCABKAIIRw0FIAAoAuTdASAAKAJMTw0FDAELAkADQCAAKAJMIghFDQFBACEGIAEoAggiCSAHTQ0CIAEoAhQiCiABKAIQIgtNDQIgACAIIAkgB2siBiAKIAtrIgkgBiAJSRsiBiAAKAIsIAAoAiAiCWsiCiAGIApJGyIGIAggBiAISRsiBms2AkwgCSAAKAIYaiABKAIAIAdqIAYQhYCAgAAaIAAgACgCICAGaiIHNgIgAkAgACgCJCAHTw0AIAAgBzYCJAsCQCAAKAI8RQ0AAkAgByAAKAIsRw0AIABBADYCIAsgASgCDCABKAIQaiABKAIAIAEoAgRqIAYQhYCAgAAaIAAoAiAhBwsgACAHNgIcIAEgASgCECAGajYCECABIAEoAgQgBmoiBzYCBAwACwsgAEEANgJADAQLIAYPCyAHwEF/Sg0BIABBATYCQCAAIAdBEHRBgID8AHE2AkgCQCAHQcABSQ0AIABBBTYCRCAAQQA6AFEMAwsgAC0AUQ0DIABBBjYCRCAHQaABSQ0CIANCADcCACADQRBqQQA2AgAgA0EIakIANwIAQfgAIQcDQCAAIAdqQYAIOwEAIAdBAmoiB0Hk3QFHDQALCyAAQQU2AgggAEL/////DzcCAAwBCyAHQQJLDQEgAEKDgICAgAE3AkAMAAsLQQcPC0EAC5wYARR/IABBGGohAQJAIABBIGooAgAiAiAAQShqKAIAIgNPDQAgAEHoAGoiBCgCAEUNACABIAQgACgCVBCegICAABogACgCKCEDIAAoAiAhAgsCQCACIANPDQAgAEHYC2ohBSAAQbwNaiEGIABB3A1qIQcgAEHoAGohCCAAQeAVaiEJIABB1ABqIQoDQCAAKAIQIgsgACgCFEsNASAAIAAoAmQiDEEFdGogACgCdCACcSINQQF0aiIOQfgAaiEPAkACQCAAKAIAIgNBgICACEkNACAAKAIEIRAMAQsgACADQQh0IgM2AgAgACALQQFqIgQ2AhAgACAAKAIEQQh0IAAoAgwgC2otAAByIhA2AgQgBCELCwJAAkAgECADQQt2IA8vAQAiEWwiBE8NACAAIAQ2AgAgDyARQYAQIBFrQQV2ajsBACACQX9qIQMCQCACDQAgACgCLCADaiEDCwJAAkAgACgCJCIRDQBBACEDDAELIAEoAgAgA2otAAAhAwsgACAAKAJwIAJxIAAoAmwiD3QgA0EIIA9rdmpBgAxsakHkHWohDgJAAkAgDEEGSw0AQQEhAwNAIA4gA0EBdCIDaiEQAkACQCAAKAIAIgRBgICACEkNACAAKAIEIQwMAQsgACAEQQh0IgQ2AgAgACAAKAIQIg9BAWo2AhAgACAAKAIEQQh0IA8gACgCDGotAAByIgw2AgQLAkACQCAMIARBC3YgEC8BACIRbCIPSQ0AIAAgDCAPazYCBCAEIA9rIQ8gA0EBciEDIBEgEUEFdmshBAwBCyARQYAQIBFrQQV2aiEECyAAIA82AgAgECAEOwEAIANBgAJJDQALIAAoAiAhAgwBCyACIAAoAlQiD0F/c2ohAwJAIAIgD0sNACAAKAIsIANqIQMLAkACQCARDQBBACESDAELIAEoAgAgA2otAAAhEgtBASEDQYACIQ8DQCAOIBJBAXQiEiAPcSITIA9qIANqQQF0aiERAkACQCAEQf///wdNDQAgBCENDAELIAAgBEEIdCINNgIAIAAgC0EBaiIENgIQIAAgEEEIdCAAKAIMIAtqLQAAciIQNgIEIAQhCwsCQAJAIBAgDUELdiARLwEAIgxsIgRPIhQNACAMQYAQIAxrQQV2aiEMDAELIAAgECAEayIQNgIEIA0gBGshBCAMIAxBBXZrIQxBACEPCyAAIAQ2AgAgESAMOwEAIA8gE3MhDyADQQF0IBRyIgNBgAJJDQALCyAAIAJBAWo2AiAgACgCGCACaiADOgAAAkAgACgCJCAAKAIgIgJPDQAgACACNgIkC0EAIQMCQCAAKAJkIgRBBEkNAAJAIARBCUsNACAEQX1qIQMMAQsgBEF6aiEDCyAAIAM2AmQMAQsgACADIARrIgM2AgAgACAQIARrIgQ2AgQgDyARIBFBBXZrOwEAIAAgDEEBdGoiEkH4A2ohDwJAAkAgA0H///8HTQ0AIAshEwwBCyAAIANBCHQiAzYCACAAIAtBAWoiEzYCECAAIARBCHQgACgCDCALai0AAHIiBDYCBAsCQAJAIAQgA0ELdiAPLwEAIhBsIhFJDQAgACADIBFrIgw2AgAgACAEIBFrIgM2AgQgDyAQIBBBBXZrOwEAIBJBkARqIQ8CQAJAIAxB////B00NACATIREMAQsgACAMQQh0Igw2AgAgACATQQFqIhE2AhAgACADQQh0IAAoAgwgE2otAAByIgM2AgQLAkACQCADIAxBC3YgDy8BACIQbCIETw0AIAAgBDYCACAPIBBBgBAgEGtBBXZqOwEAIA5B2ARqIQ8CQCAEQf///wdLDQAgACAEQQh0IgQ2AgAgACARQQFqNgIQIAAgA0EIdCAAKAIMIBFqLQAAciIDNgIECwJAIAMgBEELdiAPLwEAIhBsIhFJDQAgACAEIBFrNgIAIAAgAyARazYCBCAPIBAgEEEFdms7AQAMAgsgACARNgIAIA8gEEGAECAQa0EFdmo7AQAgAEEBNgJoIABBCUELIAAoAmRBB0kbNgJkDAMLIAAgDCAEayIMNgIAIAAgAyAEayIDNgIEIA8gECAQQQV2azsBACASQagEaiEEAkACQCAMQf///wdNDQAgESEODAELIAAgDEEIdCIMNgIAIAAgEUEBaiIONgIQIAAgA0EIdCAAKAIMIBFqLQAAciIDNgIECwJAAkAgAyAMQQt2IAQvAQAiD2wiEE8NACAAIBA2AgAgBCAPQYAQIA9rQQV2ajsBACAAKAJYIQMMAQsgACAMIBBrIhE2AgAgACADIBBrIgM2AgQgBCAPIA9BBXZrOwEAIBJBwARqIQ8CQCARQf///wdLDQAgACARQQh0IhE2AgAgACAOQQFqNgIQIAAgA0EIdCAAKAIMIA5qLQAAciIDNgIECwJAAkAgAyARQQt2IA8vAQAiEGwiBE8NACAQQYAQIBBrQQV2aiEQIAAoAlwhAwwBCyAAIAMgBGs2AgQgACgCYCEDIAAgACgCXDYCYCARIARrIQQgECAQQQV2ayEQCyAAIAQ2AgAgDyAQOwEAIAAgACgCWDYCXAsgACAAKAJUNgJYIAAgAzYCVAsgAEEIQQsgACgCZEEHSRs2AmQgACAJIA0Qn4CAgAAMAQsgACARNgIAIA8gEEGAECAQa0EFdmo7AQAgACAAKAJcNgJgIAAgACkCVDcCWCAAQQdBCiAAKAJkQQdJGzYCZCAAIAcgDRCfgICAACAKIAAoAmgiA0F+akEDIANBBkkbQQd0akGEB2ohDUEBIQMDQCANIANBAXQiA2ohEAJAAkAgACgCACIEQYCAgAhJDQAgACgCBCEMDAELIAAgBEEIdCIENgIAIAAgACgCECIPQQFqNgIQIAAgACgCBEEIdCAPIAAoAgxqLQAAciIMNgIECwJAAkAgDCAEQQt2IBAvAQAiEWwiD0kNACAAIAwgD2s2AgQgBCAPayEPIANBAXIhAyARIBFBBXZrIQQMAQsgEUGAECARa0EFdmohBAsgACAPNgIAIBAgBDsBACADQcAASQ0ACwJAIANBQGoiBEEDSw0AIAAgBDYCVAwBCyAAIANBAXFBAnIiDzYCVCAEQQF2IRACQCAEQQ1LDQAgACAPIBBBf2oiDnQiBDYCVEEBIQ8gBSAEQQF0akHAACADa0EBdGpBfmohEkEAIQwDQCASIA9BAXQiD2ohEAJAAkAgACgCACIDQYCAgAhJDQAgACgCBCENDAELIAAgA0EIdCIDNgIAIAAgACgCECIEQQFqNgIQIAAgACgCBEEIdCAEIAAoAgxqLQAAciINNgIECwJAAkAgDSADQQt2IBAvAQAiEWwiBEkNACAAIA0gBGs2AgQgACAAKAJUQQEgDHRqNgJUIAMgBGshBCAPQQFyIQ8gESARQQV2ayEDDAELIBFBgBAgEWtBBXZqIQMLIAAgBDYCACAQIAM7AQAgDiAMQQFqIgxHDQAMAgsLIBBBe2ohECAAKAIEIQQgACgCACEDA0ACQCADQf///wdLDQAgACADQQh0IgM2AgAgACAAKAIQIhFBAWo2AhAgBEEIdCARIAAoAgxqLQAAciEECyAAIANBAXYiAzYCACAAIAQgA2siBEEfdSIRIA9BAXRqQQFqIg82AlQgACARIANxIARqIgQ2AgQgEEF/aiIQDQALIAAgD0EEdDYCVEEAIQxBASEPA0AgBiAPQQF0Ig9qIRACQAJAIAAoAgAiA0GAgIAISQ0AIAAoAgQhDQwBCyAAIANBCHQiAzYCACAAIAAoAhAiBEEBajYCECAAIAAoAgRBCHQgBCAAKAIMai0AAHIiDTYCBAsCQAJAIA0gA0ELdiAQLwEAIhFsIgRJDQAgACANIARrNgIEIAAgACgCVEEBIAx0ajYCVCADIARrIQQgD0EBciEPIBEgEUEFdmshAwwBCyARQYAQIBFrQQV2aiEDCyAAIAQ2AgAgECADOwEAIAxBAWoiDEEERw0ACwsCQCABIAggACgCVBCegICAAA0AQQAPCyAAKAIgIQILIAIgACgCKEkNAAsLQQEhAwJAIAAoAgAiBEH///8HSw0AIAAgBEEIdDYCAEEBIQMgACAAKAIQIgRBAWo2AhAgACAAKAIEQQh0IAQgACgCDGotAAByNgIECyADC3ABAX8CQEGo3gEQgICAgAAiAkUNACACQTRqIAE2AgAgAkE8aiAANgIAAkACQAJAIABBf2oOAgABAgsgAiABEICAgIAAIgA2AhggAA0BIAIQgoCAgAAMAgsgAkEANgIYIAJBOGpBADYCAAsgAg8LQQAL0gEBAn9BBiECAkAgAUEnSw0AIABBMGogAUEBcUECciABQQF2QQtqdCIBNgIAAkACQCAAQTxqKAIAIgNFDQBBBCECIAEgAEE0aigCAEsNAiAAQSxqIAE2AgAgA0ECRw0AIABBOGoiAygCACABTw0AIAAgATYCOCAAKAIYEIKAgIAAIAAgACgCMBCAgICAACIBNgIYIAENAEEDIQIMAQtBACECIABBADYCQCAAQdAAakEBOgAAIABB6ABqQQA2AgAgAEHk3QFqIQMLIANBADYCAAsgAgsjAAJAIABBPGooAgBFDQAgACgCGBCCgICAAAsgABCCgICAAAvHAQEDf0EAIQMCQCAAKAIMIAJNDQAgACgCGCACTQ0AIAEgASgCACIDIAAoAhAgACgCCCIEayIFIAMgBSADSRsiBWs2AgAgBCACQX9zaiEDAkAgBCACSw0AIAAoAhQgA2ohAwsDQCAAKAIAIgIgA2otAAAhASAAIAAoAggiBEEBajYCCCACIARqIAE6AABBACADQQFqIgMgAyAAKAIURhshAyAFQX9qIgUNAAtBASEDIAAoAgwgACgCCCIFTw0AIAAgBTYCDAsgAwvoBAEGfwJAAkAgACgCACIDQYCAgAhJDQAgACgCBCEEDAELIAAgA0EIdCIDNgIAIAAgACgCECIFQQFqNgIQIAAgACgCBEEIdCAFIAAoAgxqLQAAciIENgIECwJAAkAgBCADQQt2IAEvAQAiBWwiBk8NACAAIAY2AgAgASAFQYAQIAVrQQV2ajsBACABIAJBBHRqQQRqIQdBCCEIQQIhAQwBCyAAIAMgBmsiAzYCACAAIAQgBmsiBDYCBCABIAUgBUEFdms7AQACQCADQf///wdLDQAgACADQQh0IgM2AgAgACAAKAIQIgVBAWo2AhAgACAEQQh0IAUgACgCDGotAAByIgQ2AgQLAkAgBCADQQt2IAEvAQIiBWwiBk8NACAAIAY2AgAgASAFQYAQIAVrQQV2ajsBAiABIAJBBHRqQYQCaiEHQQghCEEKIQEMAQsgACADIAZrNgIAIAAgBCAGazYCBCABIAUgBUEFdms7AQIgAUGEBGohB0GAAiEIQRIhAQsgAEHoAGogATYCAEEBIQEDQCAHIAFBAXQiAWohBAJAAkAgACgCACIDQYCAgAhJDQAgACgCBCECDAELIAAgA0EIdCIDNgIAIAAgACgCECIFQQFqNgIQIAAgACgCBEEIdCAFIAAoAgxqLQAAciICNgIECwJAAkAgAiADQQt2IAQvAQAiBmwiBUkNACAAIAIgBWs2AgQgAyAFayEFIAFBAXIhASAGIAZBBXZrIQMMAQsgBkGAECAGa0EFdmohAwsgACAFNgIAIAQgAzsBACABIAhJDQALIABB6ABqIgAgASAIayAAKAIAajYCAAsLNQEAQYAICy4IAAAAEAAAABgAAAAgAAAAKAAAADAAAABAAAAAUAAAAIAAAAAAAQAA/Td6WFoA'

        /***/
      },
      /* 2 */
      /***/ module => {
        module.exports = __WEBPACK_EXTERNAL_MODULE__2__

        /***/
      },
      /******/
    ]
    /************************************************************************/
    /******/ // The module cache
    /******/ var __webpack_module_cache__ = {}
    /******/
    /******/ // The require function
    /******/ function __webpack_require__(moduleId) {
      /******/ // Check if module is in cache
      /******/ var cachedModule = __webpack_module_cache__[moduleId]
      /******/ if (cachedModule !== undefined) {
        /******/ return cachedModule.exports
        /******/
      }
      /******/ // Create a new module (and put it into the cache)
      /******/ var module = (__webpack_module_cache__[moduleId] = {
        /******/ // no module.id needed
        /******/ // no module.loaded needed
        /******/ exports: {},
        /******/
      })
      /******/
      /******/ // Execute the module function
      /******/ __webpack_modules__[moduleId](
        module,
        module.exports,
        __webpack_require__,
      )
      /******/
      /******/ // Return the exports of the module
      /******/ return module.exports
      /******/
    }
    /******/
    /************************************************************************/
    /******/ /* webpack/runtime/define property getters */
    /******/ ;(() => {
      /******/ // define getter functions for harmony exports
      /******/ __webpack_require__.d = (exports, definition) => {
        /******/ for (var key in definition) {
          /******/ if (
            __webpack_require__.o(definition, key) &&
            !__webpack_require__.o(exports, key)
          ) {
            /******/ Object.defineProperty(exports, key, {
              enumerable: true,
              get: definition[key],
            })
            /******/
          }
          /******/
        }
        /******/
      }
      /******/
    })()
    /******/
    /******/ /* webpack/runtime/hasOwnProperty shorthand */
    /******/
    ;(() => {
      /******/ __webpack_require__.o = (obj, prop) =>
        Object.prototype.hasOwnProperty.call(obj, prop)
      /******/
    })()
    /******/
    /******/ /* webpack/runtime/make namespace object */
    /******/
    ;(() => {
      /******/ // define __esModule on exports
      /******/ __webpack_require__.r = exports => {
        /******/ if (typeof Symbol !== 'undefined' && Symbol.toStringTag) {
          /******/ Object.defineProperty(exports, Symbol.toStringTag, {
            value: 'Module',
          })
          /******/
        }
        /******/ Object.defineProperty(exports, '__esModule', { value: true })
        /******/
      }
      /******/
    })()
    /******/
    /************************************************************************/
    var __webpack_exports__ = {}
    // This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
    ;(() => {
      __webpack_require__.r(__webpack_exports__)
      /* harmony export */ __webpack_require__.d(__webpack_exports__, {
        /* harmony export */ XzReadableStream: () =>
          /* binding */ XzReadableStream,
        /* harmony export */
      })
      /* harmony import */ var _dist_native_xz_decompress_wasm__WEBPACK_IMPORTED_MODULE_0__ =
        __webpack_require__(1)

      const ReadableStream =
        globalThis.ReadableStream ||
        // Node < 18 support web streams, but it's not available as a global, so we need to require it.
        // This won't be reached in modern browsers, and bundlers will ignore due to 'browser' field in package.json:
        __webpack_require__(2).ReadableStream

      const XZ_OK = 0
      const XZ_STREAM_END = 1

      class XzContext {
        constructor(moduleInstance) {
          this.exports = moduleInstance.exports
          this.memory = this.exports.memory
          this.ptr = this.exports.create_context()
          this._refresh()
          this.bufSize = this.mem32[0]
          this.inStart = this.mem32[1] - this.ptr
          this.inEnd = this.inStart + this.bufSize
          this.outStart = this.mem32[4] - this.ptr
        }

        supplyInput(sourceDataUint8Array) {
          this._refresh()
          const inBuffer = this.mem8.subarray(this.inStart, this.inEnd)
          inBuffer.set(sourceDataUint8Array, 0)
          this.exports.supply_input(this.ptr, sourceDataUint8Array.byteLength)
          this._refresh()
        }

        getNextOutput() {
          const result = this.exports.get_next_output(this.ptr)
          this._refresh()
          if (result !== XZ_OK && result !== XZ_STREAM_END) {
            throw new Error(`get_next_output failed with error code ${result}`)
          }
          const outChunk = this.mem8.slice(
            this.outStart,
            this.outStart + /* outPos */ this.mem32[5],
          )
          return { outChunk, finished: result === XZ_STREAM_END }
        }

        needsMoreInput() {
          return /* inPos */ this.mem32[2] === /* inSize */ this.mem32[3]
        }

        outputBufferIsFull() {
          return /* outPos */ this.mem32[5] === this.bufSize
        }

        resetOutputBuffer() {
          this.outPos = this.mem32[5] = 0
        }

        dispose() {
          this.exports.destroy_context(this.ptr)
          this.exports = null
        }

        _refresh() {
          if (this.memory.buffer !== this.mem8?.buffer) {
            this.mem8 = new Uint8Array(this.memory.buffer, this.ptr)
            this.mem32 = new Uint32Array(this.memory.buffer, this.ptr)
          }
        }
      }

      // Simple mutex to serialize context creation and prevent resource exhaustion
      class ContextMutex {
        constructor() {
          this.locked = false
          this.waitQueue = []
        }

        async acquire() {
          if (!this.locked) {
            this.locked = true
            return
          }

          // Wait in queue
          return new Promise(resolve => {
            this.waitQueue.push(resolve)
          })
        }

        release() {
          if (this.waitQueue.length > 0) {
            const next = this.waitQueue.shift()
            next()
          } else {
            this.locked = false
          }
        }
      }

      class XzReadableStream extends ReadableStream {
        static _moduleInstancePromise
        static _moduleInstance
        static _contextMutex = new ContextMutex()

        static async _getModuleInstance() {
          const base64Wasm =
            _dist_native_xz_decompress_wasm__WEBPACK_IMPORTED_MODULE_0__.replace(
              'data:application/wasm;base64,',
              '',
            )
          const wasmBytes = Uint8Array.from(atob(base64Wasm), c =>
            c.charCodeAt(0),
          ).buffer
          const wasmOptions = {}
          const module = await WebAssembly.instantiate(wasmBytes, wasmOptions)
          XzReadableStream._moduleInstance = module.instance
        }

        constructor(compressedStream) {
          let xzContext
          let unconsumedInput = null
          const compressedReader = compressedStream.getReader()

          super({
            async start(controller) {
              await XzReadableStream._contextMutex.acquire()

              try {
                if (!XzReadableStream._moduleInstance) {
                  await (XzReadableStream._moduleInstancePromise ||
                    (XzReadableStream._moduleInstancePromise =
                      XzReadableStream._getModuleInstance()))
                }
                xzContext = new XzContext(XzReadableStream._moduleInstance)
              } catch (error) {
                XzReadableStream._contextMutex.release()
                throw error
              }
            },

            async pull(controller) {
              try {
                if (xzContext.needsMoreInput()) {
                  if (
                    unconsumedInput === null ||
                    unconsumedInput.byteLength === 0
                  ) {
                    const { done, value } = await compressedReader.read()
                    if (!done) {
                      unconsumedInput = value
                    }
                  }
                  const nextInputLength = Math.min(
                    xzContext.bufSize,
                    unconsumedInput.byteLength,
                  )
                  xzContext.supplyInput(
                    unconsumedInput.subarray(0, nextInputLength),
                  )
                  unconsumedInput = unconsumedInput.subarray(nextInputLength)
                }

                const nextOutputResult = xzContext.getNextOutput()
                controller.enqueue(nextOutputResult.outChunk)
                xzContext.resetOutputBuffer()

                if (nextOutputResult.finished) {
                  xzContext.dispose()
                  XzReadableStream._contextMutex.release()
                  controller.close()
                }
              } catch (error) {
                if (xzContext) {
                  xzContext.dispose()
                }
                XzReadableStream._contextMutex.release()
                throw error
              }
            },
            cancel() {
              try {
                if (xzContext) {
                  xzContext.dispose()
                }
                return compressedReader.cancel()
              } finally {
                XzReadableStream._contextMutex.release()
              }
            },
          })
        }
      }
    })()

    /******/ return __webpack_exports__
    /******/
  })()
})
