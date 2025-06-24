// This extension runs in split incognito, but local storage is still shared.
// First determine if running in incognito and initialize accordingly
const isIncognitoMode = chrome.extension.inIncognitoContext;
const facilityIDKey = isIncognitoMode ? 'facilityID-incognito' : 'facilityID';
const stateKey = isIncognitoMode ? 'state-incognito' : 'state';
// declare global variables
let state = 'initializing';
let facilityID = '';
let date = new Date();
let today = date.getFullYear() + '-' + String((date.getMonth() + 1)).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
let patients = {};
let patientLists = {};
let options = {}
// set state in local storage and await initialization message from MJ to know which facility to load from local storage
chrome.action.setIcon({path:'icons/icon32-red.png'});
chrome.storage.local.set({ [stateKey]: state });
console.log('state set to: initializing, context incogito :', isIncognitoMode);
chrome.runtime.onMessageExternal.addListener(initializeExtension);
chrome.runtime.onMessage.addListener(initializeExtension);
async function initializeExtension(message, sender, sendResponse) {
  // if message is from MJ Login page -- grab and store the facilityID to names info, it's the only time this info is available
  if (message.apiCall === 'MJ_login') {
    await processMJLogin(message);
  }
  // if message contains a facilityID we can initialize the extension for that facility
  // all code for initialization runs in the next if block
  if (message.facilityID && (state === 'initializing')) {
    state = 'loading';
    options = await chrome.storage.local.get('options'); //TODO: implement real options
    // remove initialization listeners
    chrome.runtime.onMessageExternal.removeListener(initializeExtension);
    chrome.runtime.onMessage.removeListener(initializeExtension);
    // if facility name is available, set it so we can use it to look up the names for the facility name in the popup
    /*
    if (message.facilityName) { // this only works uner /api/login

      let facilityIDsToNames = await chrome.storage.local.get(['facilityIDsToNames']);
      facilityIDsToNames['facilityIDsToNames'][facilityID] = message.facilityName ? message.facilityName : 'None';
      await chrome.storage.local.set({ facilityIDsToNames: facilityIDsToNames['facilityIDsToNames'] });
    }
     */
    // check date hasn't changed since chrome opened
    date = new Date();
    today = date.getFullYear() + '-' + String((date.getMonth() + 1)).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    //set facilityID and load data from local storage
    facilityID = message.facilityID;
    let data = await chrome.storage.local.get([facilityID]);
    patients = (data.hasOwnProperty(facilityID) && data[facilityID].hasOwnProperty("Patients")) ? data[facilityID].Patients : {};
    patientLists = (data.hasOwnProperty(facilityID) && data[facilityID].hasOwnProperty("PatientLists") && data[facilityID]['PatientLists']['date'] === today) ? data[facilityID].PatientLists : {
      'date': today,
      'seenToday': [],
      'certedToday': []
    };
    // Init complete: change state to running, store state in local storage, add listeners with handlers below to await incoming messages in running state
    state = 'running';
    console.log(`Extension running with incognito: ${isIncognitoMode}, and facilityID: ${facilityID}`);
    updateBadgeCounter();
    await chrome.action.setIcon({path: 'icons/icon32.png'})
    await chrome.storage.local.set({[stateKey]: state});
    await chrome.storage.local.set({[facilityIDKey]: facilityID});
    chrome.runtime.onMessageExternal.addListener(handleExternalMessage);
    chrome.runtime.onMessage.addListener(handleInternalMessage);
    await chrome.alarms.create('queue-thirty-sec-alarm', {periodInMinutes: 0.5});
    await chrome.alarms.create('health-check-ten-min-alarm', {periodInMinutes: 10});
    chrome.alarms.onAlarm.addListener(handlePeriodicAlarm);
    // let's open or refresh all MJ and DOH pages as well -- since something caused the extension to reload -- also it's nice to open all the pages automatically
    // TODO options page entry for auto page open preferences
    await openWorkingPages();
    sendResponse({'response': 'success', 'state': 'running'});
  } else {
    sendResponse({'response': 'failure', 'state': 'initializing'});
  }

  // function definitions -- message handlers
  async function handleExternalMessage(message, sender, sendResponse) {
    // Check order.facilityID to see if it matches the one in memory
    if (message.facilityID && message.facilityID.length > 0) {
      if (message.facilityID !== facilityID) {
        // facility ID has changed -- reinitialize
        reloadExtension();
      }
    }
    switch (message.apiCall) {
      case 'MJ_open_orders':
        processMJOpenOrders(message);
        break;
      case 'MJ_patients':
        processMJPatient(message);
        break;
      case 'MJ_daily_transaction_report':
        processMJTransactionReport(message);
        break;
      case 'setFacilityID':
        await setFacilityID(message);
        break;
      case 'MJ_login':
        await processMJLogin(message);
        break;
      default:
        console.warn('No handler for external sender: ', message);
        break;
    }
    sendResponse({'response': `background received message: ${message}`});

    // function definitions
    // functions to handle message.function switch
    async function processMJOpenOrders(order) {
      // ConsumerID is used as key for patient so if it is not present, warn and do not proceed
      if (!order.consumerID) {
        console.warn('patient missing consumer ID, ending processMJOpenOrders');
        return;
      }
      // Check date on incoming order: if it is for today, store patient, else check that today hasn't changed and either reinitialize extension or skip stale order
      if (order.orderDate) {
        if (order.orderDate !== today) {
          //Get real today's date -- we need to know the extension hasn't been left running for days with no new date set
          date = new Date();
          let actualToday = date.getFullYear() + '-' + String((date.getMonth() + 1)).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
          // compare this new date with the date in memory -- if it's really a new day we need to reload
          if (today !== actualToday) {
            console.warn('date has changed! Extension left running? Reinitializing.');
            await reloadExtension();
          }
          if (order.orderDate !== today) {
            // we know today is fresh so if this order.orderDate doesn't match then discard the order (stale order)
            //MJ sent us old order info that has nothing to do with date's patients -- ignore it
          }
        } else if (order.orderDate === today && !patientLists['seenToday'].includes(order.consumerID)) {
          // only process patients where the order date is today, and we haven't already processed this patient
          let patientObject = {
            // ...(conditional) checks property before accessing and assigns it to object property if it exists
            ...(order.hasOwnProperty('organizationID') && {'organizationID': order.organizationID}),
            ...(order.hasOwnProperty('consumerID') && {'consumerID': order.consumerID}),
            ...(order.hasOwnProperty('facilityID') && {'facilityID': order.facilityID}),
            ...(order.hasOwnProperty('consumerLicense') && {'consumerLicense': order.consumerLicense}),
            ...(order.hasOwnProperty('birthDate') && {'birthDate': formatMJBirthdate(order.birthDate)}),
            ...(order.hasOwnProperty('compoundName') && {'compoundName': order.compoundName}),
            ...(order.hasOwnProperty('orderTimeStamp') && {'orderTimeStamp': order.orderTimeStamp}),
            ...(order.hasOwnProperty('orderDate') && {'orderDate': order.orderDate})
          };
          // save patient to local storage and further process for tracking and automatically getting stateID
          // storing patient object to local storage first before searching MJ as that will update the object -- don't want to overwrite with stale data
          await storePatientObject(patientObject);
          // track any automatically processed patients by adding them to patientLists.seenToday
          patientLists['seenToday'].push(patientObject.consumerID);
          // check if this patient as been seen before -- if not, retrieve the stateID automatically and store it for use on DOH page and to avoid future lookups
          if (!patients[patientObject.stateID]) {
            // we can search MJ by consumerLicense or by compoundName
            let searchTextforMJ = patientObject.consumerLicense ?? patientObject.compoundName;
            searchMJPatient(searchTextforMJ);
          }
        }
      }
    }

    function processMJPatient(patient) {
      let patientObject = {
        // ...(conditional) checks property before accessing and assigns it to object property if it exists
        ...(patient.hasOwnProperty('organizationID') && {'organizationID': patient.organizationID}),
        ...(patient.hasOwnProperty('consumerLicense') && {'consumerLicense': patient.consumerLicense}),
        ...(patient.hasOwnProperty('consumerID') && {'consumerID': patient.consumerID}),
        ...(patient.hasOwnProperty('birthDate') && {'birthDate': formatMJBirthdate(patient.birthDate)}),
        ...(patient.hasOwnProperty('compoundName') && {'compoundName': patient.compoundName}),
        ...(patient.hasOwnProperty('orderDate') && {'orderDate': patient.orderDate}),
        ...(patient.hasOwnProperty('stateID') && {'stateID': patient.stateID}),
        ...(patient.hasOwnProperty('firstName') && {'firstName': patient.firstName}),
        ...(patient.hasOwnProperty('lastName') && {'lastName': patient.lastName}),
      };
      storePatientObject(patientObject);
    }

    function processMJTransactionReport(transactionReport) {
      console.log(transactionReport);
      let missedPatients = [];
      Object.keys(transactionReport.transactions).forEach(key => {
        if (!patientLists['seenToday'].includes(key)) {
          missedPatients.push(key);
        }
      });
      missedPatients.forEach(conID => {
        if (!patients[conID]) {
          let patient = {
            'consumerID': conID,
            'compoundName': transactionReport.transactions[conID]['compoundName'],
            'orderTimeStamp': transactionReport.transactions[conID]['orderTimeStamp']
          };
          storePatientObject(patient);
        }
      });
      patientLists['seenToday'].push(...missedPatients);
      writeFacilityKeyToStorageApi(facilityID);
    }

    async function setFacilityID(message) {
      if (message.facilityID) {
        if (facilityID !== message.facilityID) {
          // new facility being set, reload extension
          await chrome.storage.local.set({[facilityIDKey]: message.facilityID});
          reloadExtension();
        }
      }
    }

    //helper functions
    function storePatientObject(patientObject) {
      if (patients[patientObject.consumerID]) {
        // patient exists, so update with current data
        console.log('updating patient', patientObject.consumerID);
        patients[patientObject.consumerID].organizationID = patientObject.organizationID ?? patients[patientObject.consumerID].organizationID;
        patients[patientObject.consumerID].consumerLicense = patientObject.consumerLicense ?? patients[patientObject.consumerID].consumerLicense;
        patients[patientObject.consumerID].consumerID = patientObject.consumerID ?? patients[patientObject.consumerID].consumerID;
        patients[patientObject.consumerID].birthDate = patientObject.birthDate ?? patients[patientObject.consumerID].birthDate;
        patients[patientObject.consumerID].compoundName = patientObject.compoundName ?? patients[patientObject.consumerID].compoundName;
        patients[patientObject.consumerID].orderDate = patientObject.orderDate ?? patients[patientObject.consumerID].orderDate;
        patients[patientObject.consumerID].orderTimeStamp = patientObject.orderTimeStamp ?? patients[patientObject.consumerID].orderTimeStamp;
        patients[patientObject.consumerID].stateID = patientObject.stateID ?? patients[patientObject.consumerID].stateID;
        patients[patientObject.consumerID].firstName = patientObject.firstName ?? patients[patientObject.consumerID].firstName;
        patients[patientObject.consumerID].lastName = patientObject.lastName ?? patients[patientObject.consumerID].lastName;
      } else {
        console.log('storing new patient', patientObject.consumerID);
        patients[patientObject.consumerID] = patientObject;
      }
      writeFacilityKeyToStorageApi();
    }

    function formatMJBirthdate(birthDate) {
      //Takes YYYY-MM-DD HH:MM:SS and converts to MM/DD/YYYY
      const [year, month, day] = birthDate.substring(0, 10).split('-');
      return `${month}/${day}/${year}`;
    }

    async function reloadExtension() {
      await chrome.runtime.onMessageExternal.removeListener(handleExternalMessage);
      await chrome.runtime.onMessage.removeListener(handleInternalMessage);
      state = 'initializing';
      await chrome.storage.local.set({[stateKey]: state});
      chrome.runtime.onMessageExternal.addListener(initializeExtension);
      chrome.runtime.onMessage.addListener(initializeExtension);
    }
  }

  async function handleInternalMessage(message, sender, sendResponse) {
    console.log('internal message received: ', message);
    if (message.message === 'heartbeat') {
      sendResponse({'heartbeat': 'reply from background.js'});
    }
    if (message.messageFor !== 'background.js') {
      sendResponse({'success': true});
      return;
    }
    switch (message.messageSender) {
      case 'popUpClick':
        processPopUpClick(message);
        break;
      case 'padoh':
        processPatientCerted(message.stateID, message.consumerID, message.certData);
        break;
      default:
        console.warn('No handler for internal sender: ', message.messageSender);
        break;
    }
    sendResponse({'success': true});
    // function definitions
    // message.messageSender switch functions
    function processPopUpClick(message) {
      let action = message.action;
      let consumerID = message.consumerID;
      let searchTextforMJ = message.searchTextforMJ ?? '';
      switch (action) {
        case 'markCerted':
          message.certed.forEach((consumerID) => {
            if (!patientLists['certedToday'].includes(consumerID)) {
              patientLists['certedToday'].push(consumerID);
            }
          });
          writeFacilityKeyToStorageApi();
          break;
        case 'openMJPatientPage':
          searchMJPatient(searchTextforMJ);
          break;
        case 'openDOHpage':
          certPatientDOH(consumerID, 'popUpClick');
          break;
      }
    }

    function processPatientCerted(dohStateID, dohConsumerID, certData, disposition) {
      if (message.disposition === 'problem') {
        patients[dohConsumerID]['certData'] = certData;
        writeFacilityKeyToStorageApi();
      } else
      if (patients[dohConsumerID]
          && patients[dohConsumerID].stateID === dohStateID
          && !patientLists['certedToday'].includes(dohConsumerID))
      {
          patientLists['certedToday'].push(dohConsumerID);
          patients[dohConsumerID]['certData'] = certData;
          console.log('pateint marked as certed:', dohConsumerID);
          writeFacilityKeyToStorageApi();
        }
      else {
        console.error('processPatientCerted: no match on patient with doh sent:', dohConsumerID, dohStateID);
      }
    }
  }

  async function handlePeriodicAlarm(alarm) {
    if (alarm.name === 'queue-thirty-sec-alarm') {
      console.log('30 second periodic queue alarm triggered', alarm);
      // process 1 patient every 30 seconds
      let patientsToProcess = patientLists.seenToday.filter(patient => !patientLists.certedToday.includes(patient));
      for (let patient in patientsToProcess) {
        // using for in instead of .forEach because we only process a single patient per alarm
        if (options['options'].autoCert === true
            && patients[patientsToProcess[patient]].hasOwnProperty('stateID')
            && (!patients[patientsToProcess[patient]].hasOwnProperty('certData')
                || patients[patientsToProcess[patient]].certData.disposition !== 'problem')) {
          console.log("this patient would have been auto certed: ", patientsToProcess[patient]);
          certPatientDOH(patientsToProcess[patient], 'autoCert');
          writeFacilityKeyToStorageApi();
          break;
        } else if ((patients[patientsToProcess[patient]].orderTimeStamp + 30000) < (new Date().getTime())) {
          // patient without stateID still in queue after 30 seconds so look them up by name in MJ
          await searchMJPatient(patients[patientsToProcess[patient]].compoundName);
          console.log('this patient had state id looked up: ', patientsToProcess[patient]);
          writeFacilityKeyToStorageApi();
          break;
        }
      }
    }
    else if (alarm.name === 'health-check-ten-min-alarm') {
      console.log('health-check-ten-min-alarm: ', alarm);
    }
  }

  //function definitions -- these need to be accessible for both internal and external message handling
  function writeFacilityKeyToStorageApi() {
    // don't write key if not exists
    if (!facilityID || facilityID === '') {
      return;
    }
    chrome.storage.local.set({[facilityID]: {'Patients': patients, 'PatientLists': patientLists}});
    //update badge counter any time chrome.storage.local changes
    updateBadgeCounter();

    //function definitions
  }

  async function searchMJPatient(searchTextforMJ) {
    let message = {
      'messageFor': 'contentScript.js',
      'messageFunction': 'MJGetStateID',
      'searchTextforMJ': searchTextforMJ
    };
    let tabs = await chrome.tabs.query({url: 'https://*.mjplatform.com/*patients*'});
    if (tabs.length === 0) {
      //open new MJ patient details page since one not open
      await chrome.tabs.create({url: 'https://app.mjplatform.com/patients', active: true});
      tabs = await chrome.tabs.query({url: 'https://*.mjplatform.com/*'});
      await chrome.tabs.sendMessage(tabs[0].id, message, response => {
        if (chrome.runtime.lastError) {
          console.warn('openMJPatientPage: error sending message, receiver doesnt exist ', chrome.runtime.lastError);
        }
      });
    } else {
      await chrome.tabs.sendMessage(tabs[0].id, message, response => {
        if (chrome.runtime.lastError) {
          console.warn('openMJPatientPage: error sending message, receiver doesnt exist ', chrome.runtime.lastError);
        }
      });
    }
  }

  async function processMJLogin(message) {
    let mapFromStorage = await chrome.storage.local.get(['facilityIDToNameMap'])
    if (!mapFromStorage.hasOwnProperty('facilityIDToNameMap')) {
      mapFromStorage = {'facilityIDToNameMap': {}};
    }
    Object.keys(message.facilityIDToNameMap).forEach(key => {
      if (!mapFromStorage['facilityIDToNameMap'][key]) {
        mapFromStorage['facilityIDToNameMap'][key] = message.facilityIDToNameMap[key];
      }
    })
    await chrome.storage.local.set({'facilityIDToNameMap': mapFromStorage['facilityIDToNameMap']});
  }

  async function certPatientDOH(consumerID, initiator) {
    let tabs = await chrome.tabs.query({url: 'https://*.padohmmp.custhelp.com/*'});
    let patient = {
      birthDate: patients[consumerID].birthDate,
      stateID: patients[consumerID].stateID,
      lastName: patients[consumerID].lastName,
      consumerID: consumerID
    };
    let message = {
      'messageFor': 'contentScript.js',
      'messageFunction': 'DOHSearchPatient',
      'patient': patient,
      'initiator': initiator
    };
    if (tabs.length === 0) {
      //open new doh page in a tab if one isn't already open
      await chrome.tabs.create({url: 'https://padohmmp.custhelp.com/app/patient-certifications-med', active: true});
      tabs = await chrome.tabs.query({url: 'https://padohmmp.custhelp.com/*'});
      await chrome.tabs.sendMessage(tabs[0].id, message, response => {
        if (chrome.runtime.lastError) {
          console.warn('openDOHpage: error sending message, receiver doesnt exist ', chrome.runtime.lastError);
        }
      });
    } else {
      // handle patient DOH pasting
      // make tab active if manually clicked on, otherwise do it in background if autoCert
      if (initiator === 'popUpClick') { await chrome.tabs.update(tabs[0].id, {active: true}); }
      await chrome.tabs.sendMessage(tabs[0].id, message, response => {
        if (chrome.runtime.lastError) {
          console.warn('openDOHpage: error sending message, receiver doesnt exist ', chrome.runtime.lastError);
        }
      });
    }
  }

  async function updateBadgeCounter() {
    // TODO: autoCert should only flag those with certData (problems) -- need to replace this janky code with a better solution -- also check to see if running is true in both modes first
    // start with counter = 0 for both
    let badgeCounter = 0;
    let badgeCounterIncognito = 0;
    if (isIncognitoMode === false) {
      // set badgeCounter from value in memory and load incognito data to set badgeCounterIncognito
      badgeCounter = patientLists['seenToday'].length - patientLists['certedToday'].length;
      let incognitoFacilityID = await chrome.storage.local.get('facilityID-incognito');
      if (incognitoFacilityID['facilityID-incognito']) {
        let incognitoPatientLists = await chrome.storage.local.get(incognitoFacilityID['facilityID-incognito']);
        if ((incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists'] && incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists']['date']) && incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists']['date'] === today) {
          badgeCounterIncognito = incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists']['seenToday'].length - incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists']['certedToday'].length;
        }
      }
    } else {
      // set badgeCounterIncognito from value in memory and load non-incognito data to set badgeCounter
      badgeCounterIncognito = patientLists['seenToday'].length - patientLists['certedToday'].length;
      let facilityID = await chrome.storage.local.get('facilityID');
      if (facilityID['facilityID']) {
        let notIncogPtList = await chrome.storage.local.get(facilityID['facilityID']);
        if ((notIncogPtList[facilityID['facilityID']]['PatientLists'] && notIncogPtList[facilityID['facilityID']]['PatientLists']['date']) && notIncogPtList[facilityID['facilityID']]['PatientLists']['date'] === today) {
          badgeCounter = notIncogPtList[facilityID['facilityID']]['PatientLists']['seenToday'].length - notIncogPtList[facilityID['facilityID']]['PatientLists']['certedToday'].length;
        }
      }
    }
    badgeCounter += badgeCounterIncognito;
    await chrome.action.setBadgeTextColor({...(badgeCounter === 0 ? {color: 'white'} : {color: 'red'})});
    await chrome.action.setBadgeText({...(badgeCounter === 0 ? {text: ''} : {text: badgeCounter.toString()})});
  }

  async function openWorkingPages() {
    // MJ really doesn't like to have these pages opened right after login... delay 2 seconds
    setTimeout(async () => {
      let tabs = await chrome.tabs.query({url: '*://*.mjplatform.com/patients'});
      if (tabs.length === 0) {
        await chrome.tabs.create({url: 'https://app.mjplatform.com/patients', active: false});
      }
      tabs = await chrome.tabs.query({url: '*://*.mjplatform.com/retail/sales-report/transactions'});
      if (tabs.length === 0) {
        await chrome.tabs.create({url: 'https://app.mjplatform.com/retail/sales-report/transactions', active: false});
      }
      tabs = await chrome.tabs.query({url: '*://*.padohmmp.custhelp.com/app/patient-certifications-med'});
      if (tabs.length === 0) {
        await chrome.tabs.create({url: 'https://padohmmp.custhelp.com/app/patient-certifications-med', active: false});
      }
    }, 2000);
  }
}