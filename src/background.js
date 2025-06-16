// chrome.storage.local data structure
// top level is organized with keys for each facilityID so we can have two instances running in split incognito
// this avoids data corruption
// within each facility ID key:
// Patients: {{'customerID' : patientObject }, ... }
// PatientLists: { 'date': date, 'seenToday': [], 'certedToday': [], 'transactions': [] }
// where seenToday are patients added automatically, certedToday are certed date, and transactions is the daily transaction log
// ***BEGIN EXECUTABLE CODE***
const isIncognitoMode = chrome.extension.inIncognitoContext;
const facilityIDKey = isIncognitoMode ? 'facilityID-incognito' : 'facilityID';
const stateKey = isIncognitoMode ? 'state-incognito' : 'state';
// declare global variables
let date = new Date();
let today = date.getFullYear() + '-' + String((date.getMonth() + 1)).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
let patients = {};
let patientLists = {};
let facilityID = '';
startup();

async function startup() {
  await chrome.storage.local.set({ [stateKey]: 'initializing' });
  console.log('state set to: initializing, context incogito :', isIncognitoMode);
  chrome.runtime.onMessageExternal.addListener(initializeExtension);
  chrome.runtime.onMessage.addListener(initializeExtension);
}

async function initializeExtension(request, sender, sendResponse) {
  const facilityLUT = {
    'Lawrenceville': '3909',
    'Greensburg': '2666',
    'Chippewa': '6402',
    'Lancaster': '1323',
    'Philadelphia City Ave': '1720',
    'Phoenixville': '1719',
    'Erie': '6257',
    'Montgomeryville': '5423',
    'Washington': '6290',
    'Altoona': '6302',
    'Gettysburg': '6323',
    'Somerset': '6323',
    'Ambler': '5949',
    'Philadelphia Chestnut Street': '5634',
    'Wyomissing': '5867',
    'Butler': '1449',
    'Pittsburgh': '2054',
    'New Kensington': '2935'
  };
  // message recieved -- must be able to set facility ID to continue
  if (!request.facilityId && !request.webPageFacilityName) {
    sendResponse({ 'success': false });
    return;
  }
  if (request.facilityId && request.messageFor && request.messageFor === 'setFacilityID') {
    facilityID = request.facilityId ?? '';
    console.log('facility set message received in initializer, setting facility: ', facilityID);
    main();
  } else if (request.webPageFacilityName && request.webPageFacilityName !== '') {
    let facilityIDfromLUT = facilityLUT[request.webPageFacilityName];
    if (facilityIDfromLUT) {
      facilityID = facilityIDfromLUT;
      console.log('facility set message received in initializer, setting facility: ', facilityID);
      main();
    } else {
      console.log('Facility ID not in lookup table for facility name: ', request.webPageFacilityName);
    }
  }
  sendResponse({ 'success': true });
}

async function main() {
  // assign global variables
  date = new Date();
  today = date.getFullYear() + '-' + String((date.getMonth() + 1)).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  patients = {};
  patientLists = {};
  await chrome.storage.local.set({ [facilityIDKey]: facilityID });
  await loadData(facilityID);
  await chrome.storage.local.set({ [stateKey]: 'running' });
  console.log('state changed to RUNNING with facilityID: ', facilityID);
  await chrome.runtime.onMessageExternal.removeListener(initializeExtension);
  await chrome.runtime.onMessage.removeListener(initializeExtension);
  chrome.runtime.onMessageExternal.addListener(handleExternalMessage);
  chrome.runtime.onMessage.addListener(handleInternalMessage);
}

async function loadData(facilityID) {
  let data = await chrome.storage.local.get([facilityID]);
  if (data[facilityID]) {
    patients = data[facilityID].Patients ?? {};
    //check to see if patientList is from date -- if not, create new list with date's date and blank arrays for 'seenTody' and 'certedToday'
    patientLists = data[facilityID].PatientLists ?? { 'date': today, 'seenToday': [], 'certedToday': [] };
  }
  if (patientLists.date !== today) {
    console.log('patientLists outdated, clearing list and setting date');
    patientLists = { 'date': today, 'seenToday': [], 'certedToday': [] };
  }
  writeFacilityKeyToStorageApi(facilityID);
}

function processMJOpenOrders(order) {
  //ConsumerID is used as key for patient so if it is not present, warn and do not proceed
  if (!order.consumerID) {
    console.log('patient missing consumer ID, ending processMJOpenOrders');
    return;
  }
  //Check date on incoming order and see if: it's a stale order, it's for date, or the 'date' is now a different day
  if (order.orderDate) {
    if (order.orderDate !== today) {
      //Get real date's date -- we need to know the extension hasn't been left running for days with no new date set
      date = new Date();
      let todayFormatted = date.getFullYear() + '-' + String((date.getMonth() + 1)).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
      if (today !== todayFormatted) {
        console.log('date has changed! Extension left running? Reinitializing.');
        reloadExtension();
      } else if (today === todayFormatted) {
        //MJ sent us old order info that has nothing to do with date's patients -- ignore it
        console.log('stale oder, ignoring');
      }
    }
    if (order.orderDate === today) {
      let patientObject = {
        'organizationID': order.organizationID,
        'consumerID': order.consumerID,
        'facilityId': order.facilityId,
        'consumerLicense': order.consumerLicense,
        'birthDate': formatMJBirthdate(order.birthDate),
        'compoundName': order.compoundName,
        'orderDate': order.orderDate
      };
      if (!patientLists['seenToday'].includes(patientObject.consumerID)) {
        patientLists['seenToday'].push(patientObject.consumerID);
      }
      if (!patients[patientObject.consumerID]) {
        let textToPaste = patientObject.consumerLicense ?? patientObject.compoundName;
        openMJPatientPage(textToPaste);
      }

        storePatientObject(patientObject);
    }
  }
}

function processMJPatient(patient) {
  let patientObject = {
    organizationID: patient.organizationID,
    consumerLicense: patient.consumerLicense,
    consumerID: patient.consumerID,
    birthDate: formatMJBirthdate(patient.birthDate),
    compoundName: patient.compoundName,
    stateID: patient.stateID,
    firstName: patient.firstName,
    lastName: patient.lastName
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

async function storePatientObject(patientObject) {
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
    console.log('storing new patient', patientObject);
    patients[patientObject.consumerID] = patientObject;
  }
  writeFacilityKeyToStorageApi();
}

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

function writeFacilityKeyToStorageApi() {
  if (!facilityID || facilityID === '') {
    return;
  } // don't write key if not exists
  chrome.storage.local.set({
    [facilityID]:
      {
        'Patients': patients,
        'PatientLists': patientLists
      }
  });
  updateBadgeCounter();
}

function formatMJBirthdate(birthDate) {
  //Takes YYYY-MM-DD HH:MM:SS and converts to MM/DD/YYYY
  const [year, month, day] = birthDate.substring(0, 10).split('-');
  return `${month}/${day}/${year}`;
}

async function handleExternalMessage(request, sender, sendResponse) {
  console.log('external message', request);
  switch (request.endPoint) {
    case 'MJ_open_orders':
      processMJOpenOrders(request);
      break;
    case 'MJ_patients':
      processMJPatient(request);
      break;
    case 'MJ_daily_transaction_report':
      processMJTransactionReport(request);
      break;
    case 'setFacilityID':
      setFacilityID(request);
      break;
    default:
      console.log('No handler for external sender: ', request);
      break;
  }
  sendResponse({ 'success': true });
}

async function setFacilityID(request) {
  if (request.facilityId) {
    if (facilityID !== request.facilityId) {
      // new facility being set, reload extension
      await chrome.storage.local.set({ [facilityIDKey]: request.facilityId });
      reloadExtension();
    }
  }
}

async function handleInternalMessage(request, sender, sendResponse) {
  console.log('internal message: ', request);
  if (request.messageFor !== 'background.js') {
    sendResponse({ 'success': true });
    return;
  }
  switch (request.messageSender) {
    case 'popUpClick':
      processPopUpClick(request);
      break;
    case 'padoh':
      processPatientCerted(request.stateID, request.consumerID);
      break;
    default:
      console.log('No handler for internal sender: ', request.messageSender);
      break;
  }
  sendResponse({ 'success': true });
}

async function openMJPatientPage(textToPaste) {
  let message = {
    'messageFor': 'contentScript.js',
    'messageFunction': 'MJGetStateID',
    'textToPaste': textToPaste
  };
  let tabs = await chrome.tabs.query({ url: 'https://*.mjplatform.com/*patients*' });
  if (tabs.length === 0) {
    //open new MJ patient details page since one not open
    await chrome.tabs.create({ url: 'https://app.mjplatform.com/patients', active: true });
    tabs = await chrome.tabs.query({ url: 'https://*.mjplatform.com/*' });
    await chrome.tabs.sendMessage(tabs[0].id, message, response => {
      if (chrome.runtime.lastError) {
        console.warn('openMJPatientPage: error sending message, receiver doesnt exist ', chrome.runtime.lastError);
      }
    });
  } else {
    // await chrome.tabs.update(tabs[0].id, {active: true}); // no longer needed since we can control react
    await chrome.tabs.sendMessage(tabs[0].id, message, response => {
      if (chrome.runtime.lastError) {
        console.warn('openMJPatientPage: error sending message, receiver doesnt exist ', chrome.runtime.lastError);
      }
    });
  }
}

async function openDOHpage(consumerID) {
  let tabs = await chrome.tabs.query({ url: 'https://*.padohmmp.custhelp.com/*' });
  let patient = {
    birthDate: patients[consumerID].birthDate,
    stateID: patients[consumerID].stateID,
    lastName: patients[consumerID].lastName,
    consumerID: consumerID
  };
  let message = {
    'messageFor': 'contentScript.js',
    'messageFunction': 'DOHSearchPatient',
    'patient': patient
  };
  if (tabs.length === 0) {
    //open new doh page in a tab if one isn't already open
    await chrome.tabs.create({ url: 'https://padohmmp.custhelp.com/app/patient-certifications-med', active: true });
    tabs = await chrome.tabs.query({ url: 'https://padohmmp.custhelp.com/*' });
    await chrome.tabs.sendMessage(tabs[0].id, message, response => {
      if (chrome.runtime.lastError) {
        console.warn('openDOHpage: error sending message, receiver doesnt exist ', chrome.runtime.lastError);
      }
    });
  } else {
    // handle patient DOH pasting
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.tabs.sendMessage(tabs[0].id, message, response => {
      if (chrome.runtime.lastError) {
        console.warn('openDOHpage: error sending message, receiver doesnt exist ', chrome.runtime.lastError);
      }
    });
  }
}

async function reloadExtension() {
  await chrome.runtime.onMessageExternal.removeListener(handleExternalMessage);
  await chrome.runtime.onMessage.removeListener(handleInternalMessage);
  chrome.runtime.onMessageExternal.addListener(initializeExtension);
  chrome.runtime.onMessage.addListener(initializeExtension);
}

function createPatientObject(patient) {

}

async function updateBadgeCounter() {
  let badgeCounter = 0;
  let badgeCounterIncognito = 0;
  if (isIncognitoMode === false) {
    badgeCounter = patientLists['seenToday'].length - patientLists['certedToday'].length;
    let incognitoFacilityID = await chrome.storage.local.get('facilityID-incognito');
    if (incognitoFacilityID['facilityID-incognito']) {
      let incognitoPatientLists = await chrome.storage.local.get(incognitoFacilityID['facilityID-incognito']);
      if ((incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists'] && incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists']['date']) && incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists']['date'] === today) {
        badgeCounterIncognito = incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists']['seenToday'].length - incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists']['certedToday'].length;
      }
    }
  } else {
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
  chrome.action.setBadgeTextColor({ color: 'red' });
  if (badgeCounter === 0) {
    badgeCounter = "";
    chrome.action.setBadgeTextColor({ color: 'white' });
  }
  chrome.action.setBadgeText({ text: badgeCounter.toString() });
}