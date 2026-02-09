/**
 * Nigerian States and Local Governments
 * Complete list of all 36 states + FCT and their LGAs
 */

export const NIGERIAN_STATES = {
  ABIA: {
    name: 'Abia',
    code: 'AB',
    delivery_fee: 500000, // ₦5,000 in kobo
    lgas: [
      'Aba North', 'Aba South', 'Arochukwu', 'Bende', 'Ikwuano',
      'Isiala Ngwa North', 'Isiala Ngwa South', 'Isuikwuato', 'Obi Ngwa',
      'Ohafia', 'Osisioma', 'Ugwunagbo', 'Ukwa East', 'Ukwa West',
      'Umuahia North', 'Umuahia South', 'Umu Nneochi'
    ]
  },
  ADAMAWA: {
    name: 'Adamawa',
    code: 'AD',
    delivery_fee: 700000, // ₦7,000
    lgas: [
      'Demsa', 'Fufure', 'Ganye', 'Gayuk', 'Gombi', 'Grie', 'Hong',
      'Jada', 'Lamurde', 'Madagali', 'Maiha', 'Mayo Belwa', 'Michika',
      'Mubi North', 'Mubi South', 'Numan', 'Shelleng', 'Song',
      'Toungo', 'Yola North', 'Yola South'
    ]
  },
  AKWA_IBOM: {
    name: 'Akwa Ibom',
    code: 'AK',
    delivery_fee: 600000, // ₦6,000
    lgas: [
      'Abak', 'Eastern Obolo', 'Eket', 'Esit Eket', 'Essien Udim',
      'Etim Ekpo', 'Etinan', 'Ibeno', 'Ibesikpo Asutan', 'Ibiono-Ibom',
      'Ika', 'Ikono', 'Ikot Abasi', 'Ikot Ekpene', 'Ini', 'Itu',
      'Mbo', 'Mkpat-Enin', 'Nsit-Atai', 'Nsit-Ibom', 'Nsit-Ubium',
      'Obot Akara', 'Okobo', 'Onna', 'Oron', 'Oruk Anam',
      'Udung-Uko', 'Ukanafun', 'Uruan', 'Urue-Offong/Oruko', 'Uyo'
    ]
  },
  ANAMBRA: {
    name: 'Anambra',
    code: 'AN',
    delivery_fee: 500000,
    lgas: [
      'Aguata', 'Anambra East', 'Anambra West', 'Anaocha', 'Awka North',
      'Awka South', 'Ayamelum', 'Dunukofia', 'Ekwusigo', 'Idemili North',
      'Idemili South', 'Ihiala', 'Njikoka', 'Nnewi North', 'Nnewi South',
      'Ogbaru', 'Onitsha North', 'Onitsha South', 'Orumba North', 'Orumba South',
      'Oyi'
    ]
  },
  BAUCHI: {
    name: 'Bauchi',
    code: 'BA',
    delivery_fee: 700000,
    lgas: [
      'Alkaleri', 'Bauchi', 'Bogoro', 'Damban', 'Darazo', 'Dass',
      'Gamawa', 'Ganjuwa', 'Giade', 'Itas/Gadau', "Jama'are", 'Katagum',
      'Kirfi', 'Misau', 'Ningi', 'Shira', 'Tafawa Balewa', "Toro",
      'Warji', 'Zaki'
    ]
  },
  BAYELSA: {
    name: 'Bayelsa',
    code: 'BY',
    delivery_fee: 650000,
    lgas: [
      'Brass', 'Ekeremor', 'Kolokuma/Opokuma', 'Nembe',
      'Ogbia', 'Sagbama', 'Southern Ijaw', 'Yenagoa'
    ]
  },
  BENUE: {
    name: 'Benue',
    code: 'BE',
    delivery_fee: 600000,
    lgas: [
      'Ado', 'Agatu', 'Apa', 'Buruku', 'Gboko', 'Guma', 'Gwer East',
      'Gwer West', 'Katsina-Ala', 'Konshisha', 'Kwande', 'Logo',
      'Makurdi', 'Obi', 'Ogbadibo', 'Ohimini', 'Oju', 'Okpokwu',
      'Oturkpo', 'Tarka', 'Ukum', 'Ushongo', 'Vandeikya'
    ]
  },
  BORNO: {
    name: 'Borno',
    code: 'BO',
    delivery_fee: 800000, // ₦8,000
    lgas: [
      'Abadam', 'Askira/Uba', 'Bama', 'Bayo', 'Biu', 'Chibok', 'Damboa',
      'Dikwa', 'Gubio', 'Guzamala', 'Gwoza', 'Hawul', 'Jere', 'Kaga',
      'Kala/Balge', 'Konduga', 'Kukawa', 'Kwaya Kusar', 'Mafa',
      'Magumeri', 'Maiduguri', 'Marte', 'Mobbar', 'Monguno', 'Ngala',
      'Nganzai', 'Shani'
    ]
  },
  CROSS_RIVER: {
    name: 'Cross River',
    code: 'CR',
    delivery_fee: 600000,
    lgas: [
      'Abi', 'Akamkpa', 'Akpabuyo', 'Bakassi', 'Bekwarra', 'Biase',
      'Boki', 'Calabar Municipal', 'Calabar South', 'Etung', 'Ikom',
      'Obanliku', 'Obubra', 'Obudu', 'Odukpani', 'Ogoja', 'Yakuur', 'Yala'
    ]
  },
  DELTA: {
    name: 'Delta',
    code: 'DE',
    delivery_fee: 550000,
    lgas: [
      'Aniocha North', 'Aniocha South', 'Bomadi', 'Burutu', 'Ethiope East',
      'Ethiope West', 'Ika North East', 'Ika South', 'Isoko North',
      'Isoko South', 'Ndokwa East', 'Ndokwa West', 'Okpe', 'Oshimili North',
      'Oshimili South', 'Patani', 'Sapele', 'Udu', 'Ughelli North',
      'Ughelli South', 'Ukwuani', 'Uvwie', 'Warri North', 'Warri South',
      'Warri South West'
    ]
  },
  EBONYI: {
    name: 'Ebonyi',
    code: 'EB',
    delivery_fee: 550000,
    lgas: [
      'Abakaliki', 'Afikpo North', 'Afikpo South', 'Ebonyi', 'Ezza North',
      'Ezza South', 'Ikwo', 'Ishielu', 'Ivo', 'Izzi', 'Ohaozara', 'Ohaukwu', 'Onicha'
    ]
  },
  EDO: {
    name: 'Edo',
    code: 'ED',
    delivery_fee: 500000,
    lgas: [
      'Akoko-Edo', 'Egor', 'Esan Central', 'Esan North-East', 'Esan South-East',
      'Esan West', 'Etsako Central', 'Etsako East', 'Etsako West', 'Igueben',
      'Ikpoba Okha', 'Orhionmwon', 'Oredo', 'Ovia North-East', 'Ovia South-West',
      'Owan East', 'Owan West', 'Uhunmwonde'
    ]
  },
  EKITI: {
    name: 'Ekiti',
    code: 'EK',
    delivery_fee: 550000,
    lgas: [
      'Ado Ekiti', 'Efon', 'Ekiti East', 'Ekiti South-West', 'Ekiti West',
      'Emure', 'Gbonyin', 'Ido Osi', 'Ijero', 'Ikere', 'Ikole', 'Ilejemeje',
      'Irepodun/Ifelodun', 'Ise/Orun', 'Moba', 'Oye'
    ]
  },
  ENUGU: {
    name: 'Enugu',
    code: 'EN',
    delivery_fee: 500000,
    lgas: [
      'Aninri', 'Awgu', 'Enugu East', 'Enugu North', 'Enugu South',
      'Ezeagu', 'Igbo Etiti', 'Igbo Eze North', 'Igbo Eze South',
      'Isi Uzo', 'Nkanu East', 'Nkanu West', 'Nsukka', 'Oji River',
      'Udenu', 'Udi', 'Uzo Uwani'
    ]
  },
  FCT: {
    name: 'Federal Capital Territory',
    code: 'FC',
    delivery_fee: 350000, // ₦3,500 (cheapest, capital)
    lgas: [
      'Abaji', 'Bwari', 'Gwagwalada', 'Kuje', 'Kwali', 'Municipal Area Council'
    ]
  },
  GOMBE: {
    name: 'Gombe',
    code: 'GO',
    delivery_fee: 700000,
    lgas: [
      'Akko', 'Balanga', 'Billiri', 'Dukku', 'Funakaye', 'Gombe',
      'Kaltungo', 'Kwami', 'Nafada', 'Shomgom', 'Yamaltu/Deba'
    ]
  },
  IMO: {
    name: 'Imo',
    code: 'IM',
    delivery_fee: 500000,
    lgas: [
      'Aboh Mbaise', 'Ahiazu Mbaise', 'Ehime Mbano', 'Ezinihitte', 'Ideato North',
      'Ideato South', 'Ihitte/Uboma', 'Ikeduru', 'Isiala Mbano', 'Isu',
      'Mbaitoli', 'Ngor Okpala', 'Njaba', 'Nkwerre', 'Nwangele', 'Obowo',
      'Oguta', 'Ohaji/Egbema', 'Okigwe', 'Orlu', 'Orsu', 'Oru East',
      'Oru West', 'Owerri Municipal', 'Owerri North', 'Owerri West', 'Unuimo'
    ]
  },
  JIGAWA: {
    name: 'Jigawa',
    code: 'JI',
    delivery_fee: 700000,
    lgas: [
      'Auyo', 'Babura', 'Biriniwa', 'Birnin Kudu', 'Buji', 'Dutse',
      'Gagarawa', 'Garki', 'Gumel', 'Guri', 'Gwaram', 'Gwiwa',
      'Hadejia', 'Jahun', 'Kafin Hausa', 'Kazaure', 'Kiri Kasama',
      'Kiyawa', 'Kaugama', 'Maigatari', 'Malam Madori', 'Miga',
      'Ringim', 'Roni', 'Sule Tankarkar', 'Taura', 'Yankwashi'
    ]
  },
  KADUNA: {
    name: 'Kaduna',
    code: 'KD',
    delivery_fee: 600000,
    lgas: [
      'Birnin Gwari', 'Chikun', 'Giwa', 'Igabi', 'Ikara', 'Jaba',
      "Jema'a", 'Kachia', 'Kaduna North', 'Kaduna South', 'Kagarko',
      'Kajuru', 'Kaura', 'Kauru', 'Kubau', 'Kudan', 'Lere',
      'Makarfi', 'Sabon Gari', 'Sanga', 'Soba', 'Zangon Kataf', 'Zaria'
    ]
  },
  KANO: {
    name: 'Kano',
    code: 'KN',
    delivery_fee: 600000,
    lgas: [
      'Ajingi', 'Albasu', 'Bagwai', 'Bebeji', 'Bichi', 'Bunkure',
      'Dala', 'Dambatta', 'Dawakin Kudu', 'Dawakin Tofa', 'Doguwa',
      'Fagge', 'Gabasawa', 'Garko', 'Garun Mallam', 'Gaya', 'Gezawa',
      'Gwale', 'Gwarzo', 'Kabo', 'Kano Municipal', 'Karaye', 'Kibiya',
      'Kiru', 'Kumbotso', 'Kunchi', 'Kura', 'Madobi', 'Makoda',
      'Minjibir', 'Nasarawa', 'Rano', 'Rimin Gado', 'Rogo', 'Shanono',
      'Sumaila', 'Takai', 'Tarauni', 'Tofa', 'Tsanyawa', 'Tudun Wada',
      'Ungogo', 'Warawa', 'Wudil'
    ]
  },
  KATSINA: {
    name: 'Katsina',
    code: 'KT',
    delivery_fee: 650000,
    lgas: [
      'Bakori', 'Batagarawa', 'Batsari', 'Baure', 'Bindawa', 'Charanchi',
      'Dandume', 'Danja', 'Dan Musa', 'Daura', 'Dutsi', 'Dutsin Ma',
      'Faskari', 'Funtua', 'Ingawa', 'Jibia', 'Kafur', 'Kaita',
      'Kankara', 'Kankia', 'Katsina', 'Kurfi', 'Kusada', 'Mai\'Adua',
      'Malumfashi', 'Mani', 'Mashi', 'Matazu', 'Musawa', 'Rimi',
      'Sabuwa', 'Safana', 'Sandamu', 'Zango'
    ]
  },
  KEBBI: {
    name: 'Kebbi',
    code: 'KE',
    delivery_fee: 700000,
    lgas: [
      'Aleiro', 'Arewa Dandi', 'Argungu', 'Augie', 'Bagudo',
      'Birnin Kebbi', 'Bunza', 'Dandi', 'Fakai', 'Gwandu', 'Jega',
      'Kalgo', 'Koko/Besse', 'Maiyama', 'Ngaski', 'Sakaba', 'Shanga',
      'Suru', 'Wasagu/Danko', 'Yauri', 'Zuru'
    ]
  },
  KOGI: {
    name: 'Kogi',
    code: 'KO',
    delivery_fee: 550000,
    lgas: [
      'Adavi', 'Ajaokuta', 'Ankpa', 'Bassa', 'Dekina', 'Ibaji',
      'Idah', 'Igalamela Odolu', 'Ijumu', 'Kabba/Bunu', 'Kogi',
      'Lokoja', 'Mopa Muro', 'Ofu', 'Ogori/Magongo', 'Okehi',
      'Okene', 'Olamaboro', 'Omala', 'Yagba East', 'Yagba West'
    ]
  },
  KWARA: {
    name: 'Kwara',
    code: 'KW',
    delivery_fee: 550000,
    lgas: [
      'Asa', 'Baruten', 'Edu', 'Ekiti', 'Ifelodun', 'Ilorin East',
      'Ilorin South', 'Ilorin West', 'Irepodun', 'Isin', 'Kaiama',
      'Moro', 'Offa', 'Oke Ero', 'Oyun', 'Pategi'
    ]
  },
  LAGOS: {
    name: 'Lagos',
    code: 'LA',
    delivery_fee: 300000, // ₦3,000 (cheapest with FCT, commercial hub)
    lgas: [
      'Agege', 'Ajeromi-Ifelodun', 'Alimosho', 'Amuwo-Odofin', 'Apapa',
      'Badagry', 'Epe', 'Eti Osa', 'Ibeju-Lekki', 'Ifako-Ijaiye',
      'Ikeja', 'Ikorodu', 'Kosofe', 'Lagos Island', 'Lagos Mainland',
      'Mushin', 'Ojo', 'Oshodi-Isolo', 'Shomolu', 'Surulere'
    ]
  },
  NASARAWA: {
    name: 'Nasarawa',
    code: 'NA',
    delivery_fee: 550000,
    lgas: [
      'Akwanga', 'Awe', 'Doma', 'Karu', 'Keana', 'Keffi', 'Kokona',
      'Lafia', 'Nasarawa', 'Nasarawa Egon', 'Obi', 'Toto', 'Wamba'
    ]
  },
  NIGER: {
    name: 'Niger',
    code: 'NI',
    delivery_fee: 600000,
    lgas: [
      'Agaie', 'Agwara', 'Bida', 'Borgu', 'Bosso', 'Chanchaga', 'Edati',
      'Gbako', 'Gurara', 'Katcha', 'Kontagora', 'Lapai', 'Lavun',
      'Magama', 'Mariga', 'Mashegu', 'Mokwa', 'Moya', 'Paikoro',
      'Rafi', 'Rijau', 'Shiroro', 'Suleja', 'Tafa', 'Wushishi'
    ]
  },
  OGUN: {
    name: 'Ogun',
    code: 'OG',
    delivery_fee: 400000, // ₦4,000
    lgas: [
      'Abeokuta North', 'Abeokuta South', 'Ado-Odo/Ota', 'Egbado North',
      'Egbado South', 'Ewekoro', 'Ifo', 'Ijebu East', 'Ijebu North',
      'Ijebu North East', 'Ijebu Ode', 'Ikenne', 'Imeko Afon',
      'Ipokia', 'Obafemi Owode', 'Odeda', 'Odogbolu', 'Ogun Waterside',
      'Remo North', 'Shagamu'
    ]
  },
  ONDO: {
    name: 'Ondo',
    code: 'ON',
    delivery_fee: 550000,
    lgas: [
      'Akoko North-East', 'Akoko North-West', 'Akoko South-West',
      'Akoko South-East', 'Akure North', 'Akure South', 'Ese Odo',
      'Idanre', 'Ifedore', 'Ilaje', 'Ile Oluji/Okeigbo', 'Irele',
      'Odigbo', 'Okitipupa', 'Ondo East', 'Ondo West', 'Ose', 'Owo'
    ]
  },
  OSUN: {
    name: 'Osun',
    code: 'OS',
    delivery_fee: 500000,
    lgas: [
      'Atakunmosa East', 'Atakunmosa West', 'Aiyedaade', 'Aiyedire',
      'Boluwaduro', 'Boripe', 'Ede North', 'Ede South', 'Ife Central',
      'Ife East', 'Ife North', 'Ife South', 'Egbedore', 'Ejigbo',
      'Ifedayo', 'Ifelodun', 'Ila', 'Ilesa East', 'Ilesa West',
      'Irepodun', 'Irewole', 'Isokan', 'Iwo', 'Obokun', 'Odo Otin',
      'Ola Oluwa', 'Olorunda', 'Oriade', 'Orolu', 'Osogbo'
    ]
  },
  OYO: {
    name: 'Oyo',
    code: 'OY',
    delivery_fee: 500000,
    lgas: [
      'Afijio', 'Akinyele', 'Atiba', 'Atisbo', 'Egbeda', 'Ibadan North',
      'Ibadan North-East', 'Ibadan North-West', 'Ibadan South-East',
      'Ibadan South-West', 'Ibarapa Central', 'Ibarapa East', 'Ibarapa North',
      'Ido', 'Irepo', 'Iseyin', 'Itesiwaju', 'Iwajowa', 'Kajola',
      'Lagelu', 'Ogbomosho North', 'Ogbomosho South', 'Ogo Oluwa',
      'Olorunsogo', 'Oluyole', 'Ona Ara', 'Orelope', 'Ori Ire',
      'Oyo East', 'Oyo West', 'Saki East', 'Saki West', 'Surulere'
    ]
  },
  PLATEAU: {
    name: 'Plateau',
    code: 'PL',
    delivery_fee: 650000,
    lgas: [
      'Bokkos', 'Barkin Ladi', 'Bassa', 'Jos East', 'Jos North',
      'Jos South', 'Kanam', 'Kanke', 'Langtang North', 'Langtang South',
      'Mangu', 'Mikang', 'Pankshin', 'Qua\'an Pan', 'Riyom', 'Shendam', 'Wase'
    ]
  },
  RIVERS: {
    name: 'Rivers',
    code: 'RI',
    delivery_fee: 550000,
    lgas: [
      'Abua/Odual', 'Ahoada East', 'Ahoada West', 'Akuku-Toru', 'Andoni',
      'Asari-Toru', 'Bonny', 'Degema', 'Eleme', 'Emohua', 'Etche',
      'Gokana', 'Ikwerre', 'Khana', 'Obio/Akpor', 'Ogba/Egbema/Ndoni',
      'Ogu/Bolo', 'Okrika', 'Omuma', 'Opobo/Nkoro', 'Oyigbo',
      'Port Harcourt', 'Tai'
    ]
  },
  SOKOTO: {
    name: 'Sokoto',
    code: 'SO',
    delivery_fee: 700000,
    lgas: [
      'Binji', 'Bodinga', 'Dange Shuni', 'Gada', 'Goronyo', 'Gudu',
      'Gwadabawa', 'Illela', 'Isa', 'Kebbe', 'Kware', 'Rabah',
      'Sabon Birni', 'Shagari', 'Silame', 'Sokoto North', 'Sokoto South',
      'Tambuwal', 'Tangaza', 'Tureta', 'Wamako', 'Wurno', 'Yabo'
    ]
  },
  TARABA: {
    name: 'Taraba',
    code: 'TA',
    delivery_fee: 700000,
    lgas: [
      'Ardo Kola', 'Bali', 'Donga', 'Gashaka', 'Gassol', 'Ibi',
      'Jalingo', 'Karim Lamido', 'Kumi', 'Lau', 'Sardauna', 'Takum',
      'Ussa', 'Wukari', 'Yorro', 'Zing'
    ]
  },
  YOBE: {
    name: 'Yobe',
    code: 'YO',
    delivery_fee: 750000,
    lgas: [
      'Bade', 'Bursari', 'Damaturu', 'Fika', 'Fune', 'Geidam',
      'Gujba', 'Gulani', 'Jakusko', 'Karasuwa', 'Machina', 'Nangere',
      'Nguru', 'Potiskum', 'Tarmuwa', 'Yunusari', 'Yusufari'
    ]
  },
  ZAMFARA: {
    name: 'Zamfara',
    code: 'ZA',
    delivery_fee: 700000,
    lgas: [
      'Anka', 'Bakura', 'Birnin Magaji/Kiyaw', 'Bukkuyum', 'Bungudu',
      'Gummi', 'Gusau', 'Kaura Namoda', 'Maradun', 'Maru', 'Shinkafi',
      'Talata Mafara', 'Chafe', 'Zurmi'
    ]
  }
};

/**
 * Get all states with delivery fees
 */
export const getAllStates = () => {
  return Object.values(NIGERIAN_STATES).map(state => ({
    name: state.name,
    code: state.code,
    delivery_fee: state.delivery_fee
  }));
};

/**
 * Get LGAs for a specific state
 */
export const getLGAsByState = (stateCode) => {
  const state = Object.values(NIGERIAN_STATES).find(s => s.code === stateCode);
  return state ? state.lgas : [];
};

/**
 * Get delivery fee for a state
 */
export const getDeliveryFee = (stateCode) => {
  const state = Object.values(NIGERIAN_STATES).find(s => s.code === stateCode);
  return state ? state.delivery_fee : 500000; // Default ₦5,000
};

/**
 * Validate state and LGA
 */
export const validateStateAndLGA = (stateCode, lga) => {
  const state = Object.values(NIGERIAN_STATES).find(s => s.code === stateCode);
  
  if (!state) {
    return { valid: false, error: 'Invalid state selected' };
  }
  
  if (!state.lgas.includes(lga)) {
    return { valid: false, error: 'Invalid local government for selected state' };
  }
  
  return { valid: true, delivery_fee: state.delivery_fee };
};

/**
 * Get state code from state_id (numeric index) or state code (string)
 * Supports both ID-based and code-based lookups for frontend compatibility
 * 
 * @param {number|string} stateInput - State ID (number) or state code (string like "LA")
 * @returns {string|null} State code or null if not found
 */
export const getStateCodeFromInput = (stateInput) => {
  // If it's already a string, assume it's a state code
  if (typeof stateInput === 'string') {
    const state = Object.values(NIGERIAN_STATES).find(s => s.code === stateInput);
    return state ? state.code : null;
  }
  
  // If it's a number, treat it as an array index
  if (typeof stateInput === 'number') {
    const states = Object.values(NIGERIAN_STATES);
    if (stateInput >= 0 && stateInput < states.length) {
      return states[stateInput].code;
    }
  }
  
  return null;
};

/**
 * Get LGA name from lga_id (numeric index) and state code, or LGA name (string)
 * Supports both ID-based and name-based lookups for frontend compatibility
 * 
 * @param {number|string} lgaInput - LGA ID (number) or LGA name (string)
 * @param {string} stateCode - State code (like "LA") to look up LGAs
 * @returns {string|null} LGA name or null if not found
 */
export const getLGANameFromInput = (lgaInput, stateCode) => {
  // If it's already a string, assume it's an LGA name
  if (typeof lgaInput === 'string') {
    const state = Object.values(NIGERIAN_STATES).find(s => s.code === stateCode);
    if (state && state.lgas.includes(lgaInput)) {
      return lgaInput;
    }
    return null;
  }
  
  // If it's a number, treat it as an array index within the state's LGAs
  if (typeof lgaInput === 'number') {
    const state = Object.values(NIGERIAN_STATES).find(s => s.code === stateCode);
    if (state && lgaInput >= 0 && lgaInput < state.lgas.length) {
      return state.lgas[lgaInput];
    }
  }
  
  return null;
};

/**
 * Resolve state and LGA from IDs or codes/names
 * Handles both frontend formats: state_id/lga_id (numbers) or state/lga (strings)
 * 
 * @param {number|string} stateInput - State ID or state code
 * @param {number|string} lgaInput - LGA ID or LGA name
 * @returns {Object} { valid, stateCode, lgaName, delivery_fee, error }
 */
export const resolveStateAndLGA = (stateInput, lgaInput) => {
  // First, resolve state code
  const stateCode = getStateCodeFromInput(stateInput);
  if (!stateCode) {
    return { 
      valid: false, 
      error: typeof stateInput === 'number' 
        ? 'Invalid state_id' 
        : 'Invalid state code' 
    };
  }
  
  // Then, resolve LGA name using the state code
  const lgaName = getLGANameFromInput(lgaInput, stateCode);
  if (!lgaName) {
    return { 
      valid: false, 
      error: typeof lgaInput === 'number' 
        ? 'Invalid lga_id for selected state' 
        : 'Invalid LGA name for selected state' 
    };
  }
  
  // Validate the resolved state and LGA
  const validation = validateStateAndLGA(stateCode, lgaName);
  
  // Return validation result with resolved values
  return {
    ...validation,
    stateCode,
    lgaName
  };
};