/**
 * Nigeria's states and local government areas.
 *
 * WHY A FILE AND NOT A TABLE. This list changes roughly never — the
 * 36 states and the FCT have been fixed since 1996, and the 774 LGAs
 * since the same year. Putting it in the database would mean a join
 * on every address read, a seed migration to keep in step, and a way
 * for two environments to disagree about what a valid LGA is. As a
 * module it is the same everywhere, it is diffable, and the compiler
 * can check that a state code exists.
 *
 * CODES, NOT NAMES, ARE WHAT WE STORE. Names get re-spelled — Yewa
 * North was Egbado North, Aiyedaade was Ayedaade, and half the list
 * has an accepted variant. An address recorded against a name would
 * quietly stop matching the moment anyone corrected a spelling. So
 * the columns keep a code AND the name as it read when it was chosen:
 * the code is what joins, the name is what the investor saw and what
 * a tax document must be able to reproduce years later.
 *
 * State codes are ISO 3166-2:NG, minus the "NG-" prefix. LGA codes
 * are the state code plus a slug of the name, so inserting or
 * renaming an entry cannot renumber the ones around it.
 */

export type NigerianState = {
  /** ISO 3166-2:NG without the NG- prefix, e.g. "LA" */
  code: string;
  name: string;
};

export type NigerianLga = {
  /** e.g. "LA-IKEJA" */
  code: string;
  name: string;
  stateCode: string;
};

/* ────────────────────────────────────────────────────────────────
   The states, alphabetically — which is the order they are offered
   in. The FCT sits under F for "Federal Capital Territory", where
   somebody looking for Abuja will search rather than scroll.
   ──────────────────────────────────────────────────────────────── */

export const NIGERIAN_STATES: NigerianState[] = [
  { code: "AB", name: "Abia" },
  { code: "AD", name: "Adamawa" },
  { code: "AK", name: "Akwa Ibom" },
  { code: "AN", name: "Anambra" },
  { code: "BA", name: "Bauchi" },
  { code: "BY", name: "Bayelsa" },
  { code: "BE", name: "Benue" },
  { code: "BO", name: "Borno" },
  { code: "CR", name: "Cross River" },
  { code: "DE", name: "Delta" },
  { code: "EB", name: "Ebonyi" },
  { code: "ED", name: "Edo" },
  { code: "EK", name: "Ekiti" },
  { code: "EN", name: "Enugu" },
  { code: "FC", name: "Federal Capital Territory" },
  { code: "GO", name: "Gombe" },
  { code: "IM", name: "Imo" },
  { code: "JI", name: "Jigawa" },
  { code: "KD", name: "Kaduna" },
  { code: "KN", name: "Kano" },
  { code: "KT", name: "Katsina" },
  { code: "KE", name: "Kebbi" },
  { code: "KO", name: "Kogi" },
  { code: "KW", name: "Kwara" },
  { code: "LA", name: "Lagos" },
  { code: "NA", name: "Nasarawa" },
  { code: "NI", name: "Niger" },
  { code: "OG", name: "Ogun" },
  { code: "ON", name: "Ondo" },
  { code: "OS", name: "Osun" },
  { code: "OY", name: "Oyo" },
  { code: "PL", name: "Plateau" },
  { code: "RI", name: "Rivers" },
  { code: "SO", name: "Sokoto" },
  { code: "TA", name: "Taraba" },
  { code: "YO", name: "Yobe" },
  { code: "ZA", name: "Zamfara" },
];

/* ────────────────────────────────────────────────────────────────
   The 774 local government areas, by state.
   ──────────────────────────────────────────────────────────────── */

const LGAS_BY_STATE: Record<string, string[]> = {
  AB: [
    "Aba North", "Aba South", "Arochukwu", "Bende", "Ikwuano",
    "Isiala Ngwa North", "Isiala Ngwa South", "Isuikwuato", "Obi Ngwa",
    "Ohafia", "Osisioma", "Ugwunagbo", "Ukwa East", "Ukwa West",
    "Umuahia North", "Umuahia South", "Umu Nneochi",
  ],
  AD: [
    "Demsa", "Fufore", "Ganye", "Girei", "Gombi", "Guyuk", "Hong", "Jada",
    "Lamurde", "Madagali", "Maiha", "Mayo-Belwa", "Michika", "Mubi North",
    "Mubi South", "Numan", "Shelleng", "Song", "Toungo", "Yola North",
    "Yola South",
  ],
  AK: [
    "Abak", "Eastern Obolo", "Eket", "Esit Eket", "Essien Udim", "Etim Ekpo",
    "Etinan", "Ibeno", "Ibesikpo Asutan", "Ibiono Ibom", "Ika", "Ikono",
    "Ikot Abasi", "Ikot Ekpene", "Ini", "Itu", "Mbo", "Mkpat Enin",
    "Nsit Atai", "Nsit Ibom", "Nsit Ubium", "Obot Akara", "Okobo", "Onna",
    "Oron", "Oruk Anam", "Udung Uko", "Ukanafun", "Uruan",
    "Urue-Offong/Oruko", "Uyo",
  ],
  AN: [
    "Aguata", "Anambra East", "Anambra West", "Anaocha", "Awka North",
    "Awka South", "Ayamelum", "Dunukofia", "Ekwusigo", "Idemili North",
    "Idemili South", "Ihiala", "Njikoka", "Nnewi North", "Nnewi South",
    "Ogbaru", "Onitsha North", "Onitsha South", "Orumba North",
    "Orumba South", "Oyi",
  ],
  BA: [
    "Alkaleri", "Bauchi", "Bogoro", "Damban", "Darazo", "Dass", "Gamawa",
    "Ganjuwa", "Giade", "Itas/Gadau", "Jama'are", "Katagum", "Kirfi",
    "Misau", "Ningi", "Shira", "Tafawa Balewa", "Toro", "Warji", "Zaki",
  ],
  BY: [
    "Brass", "Ekeremor", "Kolokuma/Opokuma", "Nembe", "Ogbia", "Sagbama",
    "Southern Ijaw", "Yenagoa",
  ],
  BE: [
    "Ado", "Agatu", "Apa", "Buruku", "Gboko", "Guma", "Gwer East",
    "Gwer West", "Katsina-Ala", "Konshisha", "Kwande", "Logo", "Makurdi",
    "Obi", "Ogbadibo", "Ohimini", "Oju", "Okpokwu", "Otukpo", "Tarka",
    "Ukum", "Ushongo", "Vandeikya",
  ],
  BO: [
    "Abadam", "Askira/Uba", "Bama", "Bayo", "Biu", "Chibok", "Damboa",
    "Dikwa", "Gubio", "Guzamala", "Gwoza", "Hawul", "Jere", "Kaga",
    "Kala/Balge", "Konduga", "Kukawa", "Kwaya Kusar", "Mafa", "Magumeri",
    "Maiduguri", "Marte", "Mobbar", "Monguno", "Ngala", "Nganzai", "Shani",
  ],
  CR: [
    "Abi", "Akamkpa", "Akpabuyo", "Bakassi", "Bekwarra", "Biase", "Boki",
    "Calabar Municipal", "Calabar South", "Etung", "Ikom", "Obanliku",
    "Obubra", "Obudu", "Odukpani", "Ogoja", "Yakurr", "Yala",
  ],
  DE: [
    "Aniocha North", "Aniocha South", "Bomadi", "Burutu", "Ethiope East",
    "Ethiope West", "Ika North East", "Ika South", "Isoko North",
    "Isoko South", "Ndokwa East", "Ndokwa West", "Okpe", "Oshimili North",
    "Oshimili South", "Patani", "Sapele", "Udu", "Ughelli North",
    "Ughelli South", "Ukwuani", "Uvwie", "Warri North", "Warri South",
    "Warri South West",
  ],
  EB: [
    "Abakaliki", "Afikpo North", "Afikpo South", "Ebonyi", "Ezza North",
    "Ezza South", "Ikwo", "Ishielu", "Ivo", "Izzi", "Ohaozara", "Ohaukwu",
    "Onicha",
  ],
  ED: [
    "Akoko-Edo", "Egor", "Esan Central", "Esan North-East",
    "Esan South-East", "Esan West", "Etsako Central", "Etsako East",
    "Etsako West", "Igueben", "Ikpoba-Okha", "Oredo", "Orhionmwon",
    "Ovia North-East", "Ovia South-West", "Owan East", "Owan West",
    "Uhunmwonde",
  ],
  EK: [
    "Ado Ekiti", "Efon", "Ekiti East", "Ekiti South-West", "Ekiti West",
    "Emure", "Gbonyin", "Ido-Osi", "Ijero", "Ikere", "Ikole", "Ilejemeje",
    "Irepodun/Ifelodun", "Ise/Orun", "Moba", "Oye",
  ],
  EN: [
    "Aninri", "Awgu", "Enugu East", "Enugu North", "Enugu South", "Ezeagu",
    "Igbo Etiti", "Igbo Eze North", "Igbo Eze South", "Isi Uzo",
    "Nkanu East", "Nkanu West", "Nsukka", "Oji River", "Udenu", "Udi",
    "Uzo Uwani",
  ],
  FC: [
    "Abaji", "Abuja Municipal", "Bwari", "Gwagwalada", "Kuje", "Kwali",
  ],
  GO: [
    "Akko", "Balanga", "Billiri", "Dukku", "Funakaye", "Gombe", "Kaltungo",
    "Kwami", "Nafada", "Shongom", "Yamaltu/Deba",
  ],
  IM: [
    "Aboh Mbaise", "Ahiazu Mbaise", "Ehime Mbano", "Ezinihitte",
    "Ideato North", "Ideato South", "Ihitte/Uboma", "Ikeduru",
    "Isiala Mbano", "Isu", "Mbaitoli", "Ngor Okpala", "Njaba", "Nkwerre",
    "Nwangele", "Obowo", "Oguta", "Ohaji/Egbema", "Okigwe", "Onuimo",
    "Orlu", "Orsu", "Oru East", "Oru West", "Owerri Municipal",
    "Owerri North", "Owerri West",
  ],
  JI: [
    "Auyo", "Babura", "Biriniwa", "Birnin Kudu", "Buji", "Dutse",
    "Gagarawa", "Garki", "Gumel", "Guri", "Gwaram", "Gwiwa", "Hadejia",
    "Jahun", "Kafin Hausa", "Kaugama", "Kazaure", "Kiri Kasama", "Kiyawa",
    "Maigatari", "Malam Madori", "Miga", "Ringim", "Roni",
    "Sule Tankarkar", "Taura", "Yankwashi",
  ],
  KD: [
    "Birnin Gwari", "Chikun", "Giwa", "Igabi", "Ikara", "Jaba", "Jema'a",
    "Kachia", "Kaduna North", "Kaduna South", "Kagarko", "Kajuru", "Kaura",
    "Kauru", "Kubau", "Kudan", "Lere", "Makarfi", "Sabon Gari", "Sanga",
    "Soba", "Zangon Kataf", "Zaria",
  ],
  KN: [
    "Ajingi", "Albasu", "Bagwai", "Bebeji", "Bichi", "Bunkure", "Dala",
    "Dambatta", "Dawakin Kudu", "Dawakin Tofa", "Doguwa", "Fagge",
    "Gabasawa", "Garko", "Garun Mallam", "Gaya", "Gezawa", "Gwale",
    "Gwarzo", "Kabo", "Kano Municipal", "Karaye", "Kibiya", "Kiru",
    "Kumbotso", "Kunchi", "Kura", "Madobi", "Makoda", "Minjibir",
    "Nasarawa", "Rano", "Rimin Gado", "Rogo", "Shanono", "Sumaila",
    "Takai", "Tarauni", "Tofa", "Tsanyawa", "Tudun Wada", "Ungogo",
    "Warawa", "Wudil",
  ],
  KT: [
    "Bakori", "Batagarawa", "Batsari", "Baure", "Bindawa", "Charanchi",
    "Dan Musa", "Dandume", "Danja", "Daura", "Dutsi", "Dutsin-Ma",
    "Faskari", "Funtua", "Ingawa", "Jibia", "Kafur", "Kaita", "Kankara",
    "Kankia", "Katsina", "Kurfi", "Kusada", "Mai'Adua", "Malumfashi",
    "Mani", "Mashi", "Matazu", "Musawa", "Rimi", "Sabuwa", "Safana",
    "Sandamu", "Zango",
  ],
  KE: [
    "Aleiro", "Arewa Dandi", "Argungu", "Augie", "Bagudo", "Birnin Kebbi",
    "Bunza", "Dandi", "Fakai", "Gwandu", "Jega", "Kalgo", "Koko/Besse",
    "Maiyama", "Ngaski", "Sakaba", "Shanga", "Suru", "Wasagu/Danko",
    "Yauri", "Zuru",
  ],
  KO: [
    "Adavi", "Ajaokuta", "Ankpa", "Bassa", "Dekina", "Ibaji", "Idah",
    "Igalamela-Odolu", "Ijumu", "Kabba/Bunu", "Kogi", "Lokoja",
    "Mopa-Muro", "Ofu", "Ogori/Magongo", "Okehi", "Okene", "Olamaboro",
    "Omala", "Yagba East", "Yagba West",
  ],
  KW: [
    "Asa", "Baruten", "Edu", "Ekiti", "Ifelodun", "Ilorin East",
    "Ilorin South", "Ilorin West", "Irepodun", "Isin", "Kaiama", "Moro",
    "Offa", "Oke Ero", "Oyun", "Pategi",
  ],
  LA: [
    "Agege", "Ajeromi-Ifelodun", "Alimosho", "Amuwo-Odofin", "Apapa",
    "Badagry", "Epe", "Eti-Osa", "Ibeju-Lekki", "Ifako-Ijaiye", "Ikeja",
    "Ikorodu", "Kosofe", "Lagos Island", "Lagos Mainland", "Mushin", "Ojo",
    "Oshodi-Isolo", "Shomolu", "Surulere",
  ],
  NA: [
    "Akwanga", "Awe", "Doma", "Karu", "Keana", "Keffi", "Kokona", "Lafia",
    "Nasarawa", "Nasarawa Egon", "Obi", "Toto", "Wamba",
  ],
  NI: [
    "Agaie", "Agwara", "Bida", "Borgu", "Bosso", "Chanchaga", "Edati",
    "Gbako", "Gurara", "Katcha", "Kontagora", "Lapai", "Lavun", "Magama",
    "Mariga", "Mashegu", "Mokwa", "Munya", "Paikoro", "Rafi", "Rijau",
    "Shiroro", "Suleja", "Tafa", "Wushishi",
  ],
  OG: [
    "Abeokuta North", "Abeokuta South", "Ado-Odo/Ota", "Ewekoro", "Ifo",
    "Ijebu East", "Ijebu North", "Ijebu North East", "Ijebu Ode", "Ikenne",
    "Imeko Afon", "Ipokia", "Obafemi Owode", "Odeda", "Odogbolu",
    "Ogun Waterside", "Remo North", "Sagamu", "Yewa North", "Yewa South",
  ],
  ON: [
    "Akoko North-East", "Akoko North-West", "Akoko South-East",
    "Akoko South-West", "Akure North", "Akure South", "Ese Odo", "Idanre",
    "Ifedore", "Ilaje", "Ile Oluji/Okeigbo", "Irele", "Odigbo",
    "Okitipupa", "Ondo East", "Ondo West", "Ose", "Owo",
  ],
  OS: [
    "Aiyedaade", "Aiyedire", "Atakumosa East", "Atakumosa West",
    "Boluwaduro", "Boripe", "Ede North", "Ede South", "Egbedore", "Ejigbo",
    "Ife Central", "Ife East", "Ife North", "Ife South", "Ifedayo",
    "Ifelodun", "Ila", "Ilesa East", "Ilesa West", "Irepodun", "Irewole",
    "Isokan", "Iwo", "Obokun", "Odo Otin", "Ola Oluwa", "Olorunda",
    "Oriade", "Orolu", "Osogbo",
  ],
  OY: [
    "Afijio", "Akinyele", "Atiba", "Atisbo", "Egbeda", "Ibadan North",
    "Ibadan North-East", "Ibadan North-West", "Ibadan South-East",
    "Ibadan South-West", "Ibarapa Central", "Ibarapa East", "Ibarapa North",
    "Ido", "Irepo", "Iseyin", "Itesiwaju", "Iwajowa", "Kajola", "Lagelu",
    "Ogbomosho North", "Ogbomosho South", "Ogo Oluwa", "Olorunsogo",
    "Oluyole", "Ona Ara", "Orelope", "Ori Ire", "Oyo East", "Oyo West",
    "Saki East", "Saki West", "Surulere",
  ],
  PL: [
    "Barkin Ladi", "Bassa", "Bokkos", "Jos East", "Jos North", "Jos South",
    "Kanam", "Kanke", "Langtang North", "Langtang South", "Mangu",
    "Mikang", "Pankshin", "Qua'an Pan", "Riyom", "Shendam", "Wase",
  ],
  RI: [
    "Abua/Odual", "Ahoada East", "Ahoada West", "Akuku-Toru", "Andoni",
    "Asari-Toru", "Bonny", "Degema", "Eleme", "Emohua", "Etche", "Gokana",
    "Ikwerre", "Khana", "Obio/Akpor", "Ogba/Egbema/Ndoni", "Ogu/Bolo",
    "Okrika", "Omuma", "Opobo/Nkoro", "Oyigbo", "Port Harcourt", "Tai",
  ],
  SO: [
    "Binji", "Bodinga", "Dange Shuni", "Gada", "Goronyo", "Gudu",
    "Gwadabawa", "Illela", "Isa", "Kebbe", "Kware", "Rabah", "Sabon Birni",
    "Shagari", "Silame", "Sokoto North", "Sokoto South", "Tambuwal",
    "Tangaza", "Tureta", "Wamako", "Wurno", "Yabo",
  ],
  TA: [
    "Ardo Kola", "Bali", "Donga", "Gashaka", "Gassol", "Ibi", "Jalingo",
    "Karim Lamido", "Kumi", "Lau", "Sardauna", "Takum", "Ussa", "Wukari",
    "Yorro", "Zing",
  ],
  YO: [
    "Bade", "Bursari", "Damaturu", "Fika", "Fune", "Geidam", "Gujba",
    "Gulani", "Jakusko", "Karasuwa", "Machina", "Nangere", "Nguru",
    "Potiskum", "Tarmuwa", "Yunusari", "Yusufari",
  ],
  ZA: [
    "Anka", "Bakura", "Birnin Magaji/Kiyaw", "Bukkuyum", "Bungudu",
    "Gummi", "Gusau", "Kaura Namoda", "Maradun", "Maru", "Shinkafi",
    "Talata Mafara", "Tsafe", "Zurmi",
  ],
};

/* ────────────────────────────────────────────────────────────────
   Derived lookups
   ──────────────────────────────────────────────────────────────── */

/** "Ado-Odo/Ota" → "ADO-ODO-OTA". Stable under reordering. */
function slug(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const NIGERIAN_LGAS: NigerianLga[] = Object.entries(LGAS_BY_STATE)
  .flatMap(([stateCode, names]) =>
    names.map((name) => ({
      code: `${stateCode}-${slug(name)}`,
      name,
      stateCode,
    }))
  );

const STATE_BY_CODE = new Map(NIGERIAN_STATES.map((s) => [s.code, s]));
const LGA_BY_CODE = new Map(NIGERIAN_LGAS.map((l) => [l.code, l]));
const LGAS_FOR_STATE = new Map<string, NigerianLga[]>();
for (const lga of NIGERIAN_LGAS) {
  const list = LGAS_FOR_STATE.get(lga.stateCode) ?? [];
  list.push(lga);
  LGAS_FOR_STATE.set(lga.stateCode, list);
}

export function findState(code: string | null | undefined): NigerianState | null {
  return code ? STATE_BY_CODE.get(code.trim().toUpperCase()) ?? null : null;
}

export function findLga(code: string | null | undefined): NigerianLga | null {
  return code ? LGA_BY_CODE.get(code.trim().toUpperCase()) ?? null : null;
}

/** The LGAs of one state, alphabetically. Empty for an unknown state. */
export function lgasForState(stateCode: string | null | undefined): NigerianLga[] {
  if (!stateCode) return [];
  return LGAS_FOR_STATE.get(stateCode.trim().toUpperCase()) ?? [];
}

/**
 * Does this LGA belong to this state?
 *
 * The one check that stops a form — or a hand-written API call —
 * recording Ikeja in Kano. The dropdown makes it hard; this makes it
 * impossible.
 */
export function lgaBelongsToState(
  lgaCode: string | null | undefined,
  stateCode: string | null | undefined
): boolean {
  const lga = findLga(lgaCode);
  const state = findState(stateCode);
  return Boolean(lga && state && lga.stateCode === state.code);
}

/**
 * Best-effort match of a free-text state name to a code.
 *
 * ONLY for reading what is already stored — the bulk importer and the
 * legacy single-field addresses. Nothing that accepts new input uses
 * this: an address being typed goes through the dropdown, which
 * cannot produce a name that is not on the list.
 */
export function stateCodeFromName(name: string | null | undefined): string | null {
  const raw = String(name ?? "").trim().toLowerCase();
  if (!raw) return null;
  const cleaned = raw
    .replace(/\bstate\b/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  // Abuja is what people write; the FCT is what it is called.
  if (/^(abuja|fct|federal capital territory)$/.test(cleaned)) return "FC";

  const exact = NIGERIAN_STATES.find((s) => s.name.toLowerCase() === cleaned);
  return exact?.code ?? null;
}

/** "12 Awolowo Road, Ikeja, Lagos" — for a document or a table cell. */
export function formatStructuredAddress(a: {
  street: string | null;
  city: string | null;
  lgaName: string | null;
  stateName: string | null;
}): string {
  return [a.street, a.city, a.lgaName ? `${a.lgaName} LGA` : null, a.stateName]
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}
