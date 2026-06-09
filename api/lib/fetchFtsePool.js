// Representative MSCI World Small Cap pool (~85 stocks) covering developed markets
// across North America, Europe, and Asia-Pacific.
// 10 are drawn daily via date-seeded shuffle in submit-batch.js.

const POOL = [
  // ── United States — Technology ────────────────────────────────────────────
  { sym: 'QLYS',  label: 'Qualys'              },
  { sym: 'SPSC',  label: 'SPS Commerce'        },
  { sym: 'PRGS',  label: 'Progress Software'   },
  { sym: 'PLUS',  label: 'ePlus'               },
  { sym: 'MGNI',  label: 'Magnite'             },
  { sym: 'ACLS',  label: 'Axcelis Technologies'},
  { sym: 'ICHR',  label: 'Ichor Holdings'      },
  { sym: 'DIOD',  label: 'Diodes Inc'          },
  { sym: 'AEIS',  label: 'Advanced Energy'     },
  { sym: 'CLFD',  label: 'Clearfield'          },
  { sym: 'FORM',  label: 'FormFactor'          },
  { sym: 'INTA',  label: 'Intapp'              },
  // ── United States — Healthcare ────────────────────────────────────────────
  { sym: 'IRTC',  label: 'iRhythm Technologies'},
  { sym: 'TMDX',  label: 'TransMedics Group'   },
  { sym: 'LMAT',  label: 'LeMaitre Vascular'   },
  { sym: 'NEOG',  label: 'Neogen Corporation'  },
  { sym: 'NVST',  label: 'Envista Holdings'    },
  { sym: 'PRCT',  label: 'Procept BioRobotics' },
  // ── United States — Industrials ───────────────────────────────────────────
  { sym: 'TREX',  label: 'Trex Company'        },
  { sym: 'UFPI',  label: 'UFP Industries'      },
  { sym: 'DORM',  label: 'Dorman Products'     },
  { sym: 'LCII',  label: 'LCI Industries'      },
  { sym: 'CSWI',  label: 'CSW Industrials'     },
  { sym: 'MYRG',  label: 'MYR Group'           },
  { sym: 'PLXS',  label: 'Plexus Corp'         },
  { sym: 'AAON',  label: 'AAON Inc'            },
  { sym: 'KTOS',  label: 'Kratos Defense'      },
  { sym: 'OSIS',  label: 'OSI Systems'         },
  { sym: 'MGRC',  label: 'McGrath RentCorp'    },
  { sym: 'EXPO',  label: 'Exponent Inc'        },
  { sym: 'STRL',  label: 'Sterling Infrastructure' },
  { sym: 'PRIM',  label: 'Primoris Services'   },
  { sym: 'HLIO',  label: 'Helios Technologies' },
  // ── United States — Consumer ──────────────────────────────────────────────
  { sym: 'WING',  label: 'Wingstop'            },
  { sym: 'BOOT',  label: 'Boot Barn Holdings'  },
  { sym: 'HIMS',  label: 'Hims & Hers Health'  },
  { sym: 'CELH',  label: 'Celsius Holdings'    },
  { sym: 'CAVA',  label: 'Cava Group'          },
  { sym: 'IPAR',  label: 'Inter Parfums'       },
  { sym: 'TMHC',  label: 'Taylor Morrison Home'},
  // ── United States — Financials ────────────────────────────────────────────
  { sym: 'ENVA',  label: 'Enova International' },
  { sym: 'KFRC',  label: 'Kforce'              },
  { sym: 'TFIN',  label: 'Triumph Financial'   },
  { sym: 'FCFS',  label: 'FirstCash Holdings'  },
  { sym: 'WSFS',  label: 'WSFS Financial'      },
  // ── Europe — Germany ──────────────────────────────────────────────────────
  { sym: 'AIXA.DE', label: 'Aixtron SE'        },
  { sym: 'EVT.DE',  label: 'Evotec SE'         },
  { sym: 'NDX1.DE', label: 'Nordex SE'         },
  { sym: 'SGL.DE',  label: 'SGL Carbon'        },
  { sym: 'DUE.DE',  label: 'Dürr AG'           },
  { sym: 'GXI.DE',  label: 'Gerresheimer AG'   },
  // ── Europe — United Kingdom ───────────────────────────────────────────────
  { sym: 'ITV.L',   label: 'ITV plc'           },
  { sym: 'RWS.L',   label: 'RWS Holdings'      },
  { sym: 'JDW.L',   label: 'J D Wetherspoon'   },
  { sym: 'BOO.L',   label: 'Boohoo Group'       },
  { sym: 'PETS.L',  label: 'Pets at Home'       },
  // ── Europe — France ───────────────────────────────────────────────────────
  { sym: 'FNAC.PA', label: 'Fnac Darty'        },
  // ── Europe — Netherlands ──────────────────────────────────────────────────
  { sym: 'FLOW.AS', label: 'Flow Traders'      },
  { sym: 'ALFEN.AS',label: 'Alfen NV'          },
  // ── Europe — Switzerland ──────────────────────────────────────────────────
  { sym: 'TEMN.SW', label: 'Temenos AG'        },
  // ── Europe — Sweden ───────────────────────────────────────────────────────
  { sym: 'SINCH.ST',   label: 'Sinch AB'       },
  { sym: 'VITEC-B.ST', label: 'Vitec Software' },
  // ── Europe — Denmark ──────────────────────────────────────────────────────
  { sym: 'NETC.CO',  label: 'Netcompany Group' },
  // ── Europe — Norway ───────────────────────────────────────────────────────
  { sym: 'AKSO.OL',  label: 'Aker Solutions'   },
  // ── Europe — Finland ──────────────────────────────────────────────────────
  { sym: 'ORNBV.HE', label: 'Orion Corporation'},
  // ── Asia-Pacific — Japan ──────────────────────────────────────────────────
  { sym: '6857.T',  label: 'Advantest Corp'    },
  { sym: '6952.T',  label: 'Casio Computer'    },
  { sym: '6028.T',  label: 'TechnoPro Holdings'},
  { sym: '2413.T',  label: 'M3 Inc'            },
  { sym: '3659.T',  label: 'Nexon Co'          },
  { sym: '6457.T',  label: 'Glory Ltd'         },
  { sym: '3288.T',  label: 'Open House Group'  },
  { sym: '4686.T',  label: 'Just Systems'      },
  // ── Asia-Pacific — Australia ──────────────────────────────────────────────
  { sym: 'APX.AX',  label: 'Appen Ltd'         },
  { sym: 'PPT.AX',  label: 'Perpetual Ltd'     },
  { sym: 'IEL.AX',  label: 'IDP Education'     },
  { sym: 'GNC.AX',  label: 'GrainCorp'         },
  { sym: 'NXT.AX',  label: 'NextDC'            },
  // ── Asia-Pacific — Canada ─────────────────────────────────────────────────
  { sym: 'KXS.TO',  label: 'Kinaxis'           },
  { sym: 'ENGH.TO', label: 'Enghouse Systems'  },
  { sym: 'LSPD.TO', label: 'Lightspeed Commerce'},
];

export async function fetchMsciSmallCapPool() {
  return POOL;
}
