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
// set state in local storage and await initialization message from MJ to know which facility to load from local storage
chrome.storage.local.set({ [stateKey]: state });
console.log('state set to: initializing, context incogito :', isIncognitoMode);
chrome.runtime.onMessageExternal.addListener(initializeExtension);
chrome.runtime.onMessage.addListener(initializeExtension);

async function initializeExtension(message, sender, sendResponse) {
  // if message contains a facilityID we can initialize the extension for that facility
  if (message.facilityID && state === 'initializing') {
    state = 'loading';
    chrome.runtime.onMessageExternal.removeListener(initializeExtension);
    chrome.runtime.onMessage.removeListener(initializeExtension);
    // check date hasn't changed since chrome opened
    date = new Date();
    today = date.getFullYear() + '-' + String((date.getMonth() + 1)).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    //set facilityID and load data from local storage
    facilityID = message.facilityID;
    let data = await chrome.storage.local.get([facilityID]);
    patients = (data.hasOwnProperty(facilityID) && data[facilityID].hasOwnProperty("Patients")) ? data[facilityID].Patients : {};
    patientLists = (data.hasOwnProperty(facilityID) && data[facilityID].hasOwnProperty("PatientLists") && data[facilityID]['PatientLists']['date'] === today) ? data[facilityID].PatientLists : { 'date': today, 'seenToday': [], 'certedToday': [] };
    // change state to running, store state in local storage, add listeners to await incoming messages
    state = 'running';
    console.log(`Extension running with incognito: ${isIncognitoMode}, and facilityID: ${facilityID}`);
    chrome.storage.local.set({ [stateKey]: state });
    chrome.storage.local.set({ [facilityIDKey]: facilityID });
    chrome.runtime.onMessageExternal.addListener(handleExternalMessage);
    chrome.runtime.onMessage.addListener(handleInternalMessage);
    sendResponse({'response': 'success', 'state': 'running'});
  } else {
    sendResponse({'response': 'failure', 'state': 'initializing'});
  }
  async function handleExternalMessage(message, sender, sendResponse) {
    console.log('external message', message);
    switch (message.function) {
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
      default:
        console.log('No handler for external sender: ', message);
        break;
    }
    sendResponse({ 'response': `background received message: ${ message }` });

    // function definitions
    // functions to handle message.function switch
    function processMJOpenOrders(order) {
      //ConsumerID is used as key for patient so if it is not present, warn and do not proceed
      if (!order.consumerID) {
        console.warn('patient missing consumer ID, ending processMJOpenOrders');
        return;
      }
      //Check date on incoming order: if it is for today, store patient, else check that today hasn't changed and either reinitialize extension or skip stale order
      if (order.orderDate) {
        if (order.orderDate !== today) {
          //Get real date's date -- we need to know the extension hasn't been left running for days with no new date set
          date = new Date();
          today = date.getFullYear() + '-' + String((date.getMonth() + 1)).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
          if (order.orderDate !== today) {
            // today has changed to a new date -- reinitialize
            console.log('date has changed! Extension left running? Reinitializing.');
            reloadExtension();
          } else if (order.orderDate === today) {
            //MJ sent us old order info that has nothing to do with date's patients -- ignore it
            console.log('stale oder, ignoring');
          }
        }
        if (order.orderDate === today && !patientLists['seenToday'].includes(order.consumerID)) {
          // only process patients where the order date is today, and we haven't already processed this patient
          let patientObject = {
            // ... (conditional) checks property before accessing and assigns it to object property if it exists
            ...(order.hasOwnProperty('organizationID') ? { 'organizationID' : order.organizationID } : {}),
            ...(order.hasOwnProperty('consumerID') ? {'consumerID': order.consumerID} : {}),
            ...(order.hasOwnProperty('facilityID') ? { 'facilityID' : order.facilityID } : {}),
            ...(order.hasOwnProperty('consumerLicense') ? { 'consumerLicense': order.consumerLicense } : {}),
            ...(order.hasOwnProperty('birthDate') ? { 'birthDate': formatMJBirthdate(order.birthDate) } : {}),
            ...(order.hasOwnProperty('compoundName') ? { 'compoundName': order.compoundName } : {}),
            ...(order.hasOwnProperty('orderDate') ? { 'orderDate': order.orderDate } : {}),
          };
          patientLists['seenToday'].push(patientObject.consumerID);
          if (!patients[patientObject.consumerID]) {
            let searchTextforMJ = patientObject.consumerLicense ?? patientObject.compoundName;
            openMJPatientPage(searchTextforMJ);
          }

          storePatientObject(patientObject);
        }
      }
    }
    function processMJPatient(patient) {
      let patientObject = {
        // ... (conditional) checks property before accessing and assigns it to object property if it exists
        ...(patient.hasOwnProperty('organizationID') ? { 'organizationID' : patient.organizationID } : {}),
        ...(patient.hasOwnProperty('consumerLicense') ? { 'consumerLicense': patient.consumerLicense } : {}),
        ...(patient.hasOwnProperty('consumerID') ? { 'consumerID' : patient.consumerID } : {}),
        ...(patient.hasOwnProperty('birthDate') ? { 'birthDate' : formatMJBirthdate(patient.birthDate) } : {}),
        ...(patient.hasOwnProperty('compoundName') ? { 'compoundName' : patient.compoundName } : {}),
        ...(patient.hasOwnProperty('orderDate') ? { 'orderDate': patient.orderDate } : {}),
        ...(patient.hasOwnProperty('stateID') ? { 'stateID' : patient.stateID } : {}),
        ...(patient.hasOwnProperty('firstName') ? { 'firstName' : patient.firstName } : {}),
        ...(patient.hasOwnProperty('lastName') ? { 'lastName' : patient.lastName } : {}),
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
            'compoundName': transactionReport.transactions[conID]
          };
          storePatientObject(patient);
        }
      });
      patientLists['seenToday'].push(...missedPatients);
      writeFacilityKeyToStorageApi(facilityID);
    }
    async function setFacilityID(message) {
      if (message.facilityId) {
        if (facilityID !== message.facilityId) {
          // new facility being set, reload extension
          await chrome.storage.local.set({ [facilityIDKey]: message.facilityId });
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
      await chrome.storage.local.set({ [stateKey]: state });
      chrome.runtime.onMessageExternal.addListener(initializeExtension);
      chrome.runtime.onMessage.addListener(initializeExtension);
    }
  }
  async function handleInternalMessage(message, sender, sendResponse) {
    console.log('internal message: ', message);
    if (message.messageFor !== 'background.js') {
      sendResponse({ 'success': true });
      return;
    }
    switch (message.messageSender) {
      case 'popUpClick':
        processPopUpClick(message);
        break;
      case 'padoh':
        processPatientCerted(message.stateID, message.consumerID);
        break;
      default:
        console.log('No handler for internal sender: ', message.messageSender);
        break;
    }
    sendResponse({ 'success': true });



    // function definitions
    // message.messageSender switch functions
    /* havent reviewed yet
    function processPopUpClick(message) {
      let action = message.action;
      let consumerID = message.consumerID;
      let textToPaste = message.textToPaste ?? '';
      switch (action) {
        case 'Mark Certed':
          if (!patientLists['certedToday'].includes(message.consumerID)) {
            patientLists['certedToday'].push(message.consumerID);
            writeFacilityKeyToStorageApi();
            break;
          }
          break;
        case 'Get State ID':
          openMJPatientPage(textToPaste);
          break;
        case 'View Certificate':
          openDOHpage(consumerID);
          break;
        case 'Lookup By Name':
          openMJPatientPage(textToPaste);
          break;
      }
    }
    function processPatientCerted(dohStateID, dohConsumerID) {
      if (patients[dohConsumerID] && patients[dohConsumerID].stateID === dohStateID) {
        if (!patientLists['certedToday'].includes(dohConsumerID)) {
          patientLists['certedToday'].push(dohConsumerID);
          console.log('pateint marked as certed:', dohConsumerID);
          writeFacilityKeyToStorageApi();
        }
      } else {
        console.error('processPatientCerted: no match on patient with doh sent:', dohConsumerID, dohStateID);
      }
    }
    //helper functions
*/
  }
  function writeFacilityKeyToStorageApi() {
    // don't write key if not exists
    if (!facilityID || facilityID === '') {
      return;
    }
    chrome.storage.local.set({[facilityID]: {'Patients': patients, 'PatientLists': patientLists}});
    //update badge counter any time chrome.storage.local changes
    updateBadgeCounter();

    //function definitions
    async function updateBadgeCounter() {
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
      await chrome.action.setBadgeTextColor({ ...(badgeCounter === 0 ? { color: 'white' } : { color: 'red' })});
      await chrome.action.setBadgeText({ ...(badgeCounter === 0 ? { text: '' } : { text: badgeCounter.toString() })});
    }
  }
}