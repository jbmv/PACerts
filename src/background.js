// This extension runs in split incognito, but local storage is still shared.
// First determine if running in incognito and initialize accordingly
const isIncognitoMode = chrome.extension.inIncognitoContext;
const facilityIDKey = isIncognitoMode ? 'facilityID-incognito' : 'facilityID';
const stateKey = isIncognitoMode ? 'state-incognito' : 'state';
let state = 'await activation';
chrome.storage.local.set({[stateKey]: state});
chrome.action.setIcon({path:'icons/icon32.png'});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    // open about page on install
    chrome.tabs.create({ url: 'onboarding.html' });
  }
});

chrome.runtime.onSuspend.addListener(function() {
  // on suspension, change icon to orange
  console.log("Extension is suspending. Performing cleanup...");
  cleanUpSuspend();
});

chrome.runtime.onMessage.addListener(async (message,sender,sendResponse) => {
  if (message.messageFunction === 'activate') {
    await activate();
  } else if (message.messageFunction === 'deactivate') {
    // not implemented yet
  }
})

async function activate() {
  state = 'initializing';
  // declare global variables
  let facilityID = '';
  let date = new Date();
  let today = date.getFullYear() + '-' + String((date.getMonth() + 1)).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  let patients = {};
  let patientLists = {};
  let uniqueTransactions = 0;
  let totalSales = 0.0;
  let lastHeartbeats = {};
  let healthStatus = {
    doh: false,
    mjSearch: false,
    mjQueue: false,
    mjTransactions: false
  };
// default options before loading from storage
  let options = { 'autoCert': false, 'openPages': false, 'sound': true };
// set state in local storage and await initialization message from MJ to know which facility to load from local storage
  chrome.action.setIcon({path:'icons/icon32-red.png'});
  chrome.storage.local.set({healthStatus: healthStatus});
  chrome.storage.local.set({ [stateKey]: state });
  console.log('state set to: initializing, context incogito :', isIncognitoMode);
  chrome.runtime.onMessageExternal.addListener(initializeExtension);
  chrome.runtime.onMessage.addListener(initializeExtension);
  // if any MJ or DOH pages are open, lets reload them to reinject the content scripts and see if we can get an initialization message
  let tabs = await chrome.tabs.query({url:'*://*.mjplatform.com/*'});
  tabs.forEach(tab => {
    chrome.tabs.reload(tab.id);
  })
  tabs = await chrome.tabs.query({url:'*://*.padohmmp.custhelp.com/*'});
  tabs.forEach(tab => {
    chrome.tabs.reload(tab.id);
  })

  async function initializeExtension(message, sender, sendResponse) {
    // if message is from MJ Login page -- grab and store the facilityID to names info, it's the only time this info is available
    if (message.apiCall === 'MJ_login') {
      await processMJLogin(message);
    }
    // if message contains a facilityID we can initialize the extension for that facility
    // all code for initialization runs in the next if block
    if (message.facilityID && (state === 'initializing')) {
      state = 'loading';
      if ((await chrome.storage.local.get('options')).hasOwnProperty('options')) {
        options = (await chrome.storage.local.get('options')).options;
      }
      // autocert is always off to start unless user explicitly turns it on in popup -- regardless of what is in local storage key
      options.autoCert = false;
      await chrome.storage.local.set({'options':options});
      // remove initialization listeners
      chrome.runtime.onMessageExternal.removeListener(initializeExtension);
      chrome.runtime.onMessage.removeListener(initializeExtension);
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
        'certedToday': [],
        'problems': []
      };
      // must update local storage in case this facility never existed before
      writeFacilityKeyToStorageApi();
      // Init complete: change state to running, store state in local storage, add listeners with handlers below to await incoming messages in running state
      state = 'running';
      console.log(`Extension running with incognito: ${isIncognitoMode}, and facilityID: ${facilityID}`);
      updateBadgeCounter();
      // give 3 min grace period to get all pages working
      lastHeartbeats = { 'doh': Date.now() + 180000, 'mjQueue': Date.now() + 180000, 'mjSearch': Date.now() + 60000, mjTransactions: Date.now() + 60000 };
      checkHealth();
      await chrome.storage.local.set({[stateKey]: state});
      await chrome.storage.local.set({[facilityIDKey]: facilityID});
      chrome.runtime.onMessageExternal.addListener(handleExternalMessage);
      chrome.runtime.onMessage.addListener(handleInternalMessage);
      await chrome.alarms.create('queue-alarm', {periodInMinutes: 0.25});
      await chrome.alarms.create('transaction-fetch-alarm', {periodInMinutes: 5});
      chrome.alarms.onAlarm.addListener(handlePeriodicAlarm);
      chrome.storage.local.onChanged.addListener(async (changes) => {
        if (changes['options']) {
          options = (await chrome.storage.local.get('options')).options;
          updateBadgeCounter();
        }
      })
      // let's open or refresh all MJ and DOH pages as well -- since something caused the extension to reload -- also it's nice to open all the pages automatically
      if (options.openPages) { await openWorkingPages(); }
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
            if (options.sound && !options.autoCert) {
              await createOffscreenDocument();
              await chrome.runtime.sendMessage({type: 'play-sound', sound: 'checkin.mp3'}, response => {
                if (chrome.runtime.lastError) {
                  console.log('error playing sound: ', chrome.runtime.lastError.message);
                }
              });
            }
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
        let processedPatients = [];
        if (transactionReport.transactions[Object.keys(transactionReport.transactions)[0]].orderDate === today) {
          // if the report is for today set totalSales to 0 in preparation to recalculate it from the report
          totalSales = 0.0;
          uniqueTransactions = 0;
        }
        Object.keys(transactionReport.transactions).forEach(key => {
          if (transactionReport.transactions[key].orderDate === today) {
            totalSales += parseFloat(transactionReport.transactions[key].orderTotal, 10);
            if (!processedPatients.includes(key)) {
              uniqueTransactions += 1;
            }
            if (!patientLists['seenToday'].includes(key)) {
              missedPatients.push(key);
            }
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
        if (message.url.indexOf('mjplatform.com/queue') !== -1) {
          lastHeartbeats.mjQueue = message.timeStamp;
        }
        else if (message.url.indexOf('mjplatform.com/patients') !== -1) {
          lastHeartbeats.mjSearch = message.timeStamp;
        }
        else if (message.url.indexOf('sales-report/transactions') !== -1) {
          lastHeartbeats.mjTransactions = message.timeStamp;
        }
        else if (message.url.indexOf('app/patient-certifications-med') !== -1) {
          lastHeartbeats.doh = message.timeStamp;
        }
        sendResponse({'heartbeat': 'reply from background.js'});
        await checkHealth();
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
              if (patientLists['problems'].includes(consumerID)) {
                patientLists['problems'].splice(patientLists['problems'].indexOf(consumerID), 1);
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

      async function processPatientCerted(dohStateID, dohConsumerID, certData) {
        if (certData.disposition === 'certed') {
          if (patients[dohConsumerID]
              && patients[dohConsumerID].stateID === dohStateID
              && !patientLists['certedToday'].includes(dohConsumerID)) {
            patientLists['certedToday'].push(dohConsumerID);
            patients[dohConsumerID]['certData'] = certData;
            if (patientLists['problems'].includes(dohConsumerID)) { patientLists['problems'].splice(patientLists['problems'].indexOf(dohConsumerID), 1); }
            console.log('pateint marked as certed:', dohConsumerID);
            writeFacilityKeyToStorageApi();
            console.log('pateint marked as certed:', patients[dohConsumerID]);
            if (options.autoCert) {
              await createOffscreenDocument();
              await chrome.runtime.sendMessage({type: 'play-sound', sound: 'checkin.mp3'}, response => {
                if (chrome.runtime.lastError) {
                  console.log('error playing sound: ', chrome.runtime.lastError.message);
                }
              });
            }
          } else {
            console.error('processPatientCerted: no match on patient with doh sent:', dohConsumerID, dohStateID);
          }
        } else {
          patients[dohConsumerID]['certData'] = certData;
          patientLists['problems'].push(dohConsumerID);
          if (options.sound || options.autoCert) {
            await createOffscreenDocument();
            await chrome.runtime.sendMessage({type: 'play-sound', sound: 'problemcert.wav'}, response => {
              if (chrome.runtime.lastError) {
                console.log('error playing sound: ', chrome.runtime.lastError.message);
              }
            });
          }
          writeFacilityKeyToStorageApi();

        }
      }
    }

    // function definitions -- alarms and offscreen document for notification sounds
    async function handlePeriodicAlarm(alarm) {
      if (alarm.name === 'queue-alarm') {
        console.log('queue alarm triggered', alarm);
        let healthCheck = await checkHealth();
        if (healthCheck === 'failed') {
          if (options.sound) {
            await createOffscreenDocument();
            await chrome.runtime.sendMessage({type: 'play-sound', sound: 'healthcheckfail.mp3'}, response => {
              if (chrome.runtime.lastError) {
                console.log('error playing sound: ', chrome.runtime.lastError.message);
              }
            });
          }
        }
        // process only 1 patient every trigger
        let patientsToProcess = patientLists.seenToday.filter(patient => !patientLists.certedToday.includes(patient));
        for (let patient in patientsToProcess) {
          // using for in instead of .forEach because we only process a single patient per alarm
          if (options.autoCert === true
              && patients[patientsToProcess[patient]].hasOwnProperty('stateID')
              && (!patients[patientsToProcess[patient]].hasOwnProperty('certData') || patients[patientsToProcess[patient]].certData.date !== today)) {
            console.log("auto certing: ", patientsToProcess[patient]);
            certPatientDOH(patientsToProcess[patient], 'autoCert');
            // break out of for loop -- only process 1 patient per alarm
            break;
          } else if (((patients[patientsToProcess[patient]].orderTimeStamp + 30000) < (new Date().getTime()))
              && !patients[patientsToProcess[patient]].hasOwnProperty('stateID')) {
            // patient without stateID still in queue after 30 seconds so look them up by name in MJ
            await searchMJPatient(patients[patientsToProcess[patient]].compoundName);
            console.log('this patient had state id looked up: ', patientsToProcess[patient]);
            // break out of for loop -- only process 1 patient per alarm
            break;
          }
        }
      }
      if (alarm.name === 'transaction-fetch-alarm') {
        console.log('transaction fetch triggered', alarm);
        await fetchMJTransactions();
        console.log('Refreshing MJ Transactions');
      }
    }

    //function definitions -- these need to be accessible for both internal and external message handling
    function writeFacilityKeyToStorageApi() {
      // don't write key if not exists
      if (!facilityID || facilityID === '') {
        return;
      }
      chrome.storage.local.set({[facilityID]: {'Patients': patients, 'PatientLists': patientLists, 'TotalSales': totalSales, 'UniqueTransactions': uniqueTransactions}});
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
        lastHeartbeats.mjSearch = 1;
        await checkHealth();
      } else {
        await chrome.tabs.sendMessage(tabs[0].id, message, response => {
          if (chrome.runtime.lastError) {
            console.warn('openMJPatientPage: error sending message, receiver doesnt exist ', chrome.runtime.lastError);
          }
        });
      }
    }

    async function fetchMJTransactions() {
      let message = {
        'messageFor': 'contentScript.js',
        'messageFunction': 'MJGetTransactions'
      };
      let tabs = await chrome.tabs.query({url: 'https://*.mjplatform.com/*transactions*'});
      if (tabs.length === 0) {
        lastHeartbeats.mjTransactions = 1;
        await checkHealth();
      } else {
        await chrome.tabs.sendMessage(tabs[0].id, message, response => {
          if (chrome.runtime.lastError) {
            console.warn('openMJTransactionPage: error sending message, receiver doesnt exist ', chrome.runtime.lastError);
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
      let tabs = await chrome.tabs.query({url: '*://*.padohmmp.custhelp.com/app/patient-certifications-med*'});
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
        /* used to do this, auto open pages is annoying though
        //open new doh page in a tab if one isn't already open
        await chrome.tabs.create({url: 'https://padohmmp.custhelp.com/app/patient-certifications-med', active: true});
        tabs = await chrome.tabs.query({url: 'https://padohmmp.custhelp.com/*'});
        await chrome.tabs.sendMessage(tabs[0].id, message, response => {
          if (chrome.runtime.lastError) {
            console.warn('openDOHpage: error sending message, receiver doesnt exist ', chrome.runtime.lastError);
          }
        });
         */
        console.log('doh page not found -- flagging');
        lastHeartbeats.doh = 1;
        await checkHealth();
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
        let oldCount = await chrome.action.getBadgeText({});
        // start with counter = 0 for both
        let badgeCounter = 0;
        let badgeCounterIncognito = 0;
        switch (options.autoCert) {
          case true:
            if (isIncognitoMode === false) {
              // set badgeCounter from value in memory and load incognito data to set badgeCounterIncognito
              badgeCounter = patientLists['problems'].length;
              let incognitoFacilityID = await chrome.storage.local.get('facilityID-incognito');
              if (incognitoFacilityID['facilityID-incognito'] && facilityID !== incognitoFacilityID['facilityID-incognito']) {
                let incognitoPatientLists = await chrome.storage.local.get(incognitoFacilityID['facilityID-incognito']);
                if ((incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists'] && incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists']['date']) && incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists']['date'] === today) {
                  badgeCounterIncognito = incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists']['problems'].length;
                }
              } else {
                badgeCounterIncognito = 0;
              }
            } else {
              // set badgeCounterIncognito from value in memory and load non-incognito data to set badgeCounter
              badgeCounterIncognito = patientLists['problems'].length;
              let facilityID = await chrome.storage.local.get('facilityID');
              if (facilityID['facilityID'] && facilityID['facilityID'] !== facilityID) {
                let notIncogPtList = await chrome.storage.local.get(facilityID['facilityID']);
                if ((notIncogPtList[facilityID['facilityID']]['PatientLists'] && notIncogPtList[facilityID['facilityID']]['PatientLists']['date']) && notIncogPtList[facilityID['facilityID']]['PatientLists']['date'] === today) {
                  badgeCounter = notIncogPtList[facilityID['facilityID']]['PatientLists']['problems'].length;
                }
              } else {
                badgeCounter = 0;
              }
            }
            badgeCounter += badgeCounterIncognito;
            await chrome.action.setBadgeTextColor({...(badgeCounter === 0 ? {color: 'white'} : {color: 'red'})});
            await chrome.action.setBadgeText({...(badgeCounter === 0 ? {text: ''} : {text: badgeCounter.toString()})});
            break;
          case false:
            // start with counter = 0 for both
            if (isIncognitoMode === false) {
              // set badgeCounter from value in memory and load incognito data to set badgeCounterIncognito
              badgeCounter = patientLists['seenToday'].length - patientLists['certedToday'].length;
              let incognitoFacilityID = await chrome.storage.local.get('facilityID-incognito');
              if (incognitoFacilityID['facilityID-incognito'] && facilityID !== incognitoFacilityID['facilityID-incognito']) {
                let incognitoPatientLists = await chrome.storage.local.get(incognitoFacilityID['facilityID-incognito']);
                if ((incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists'] && incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists']['date']) && incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists']['date'] === today) {
                  badgeCounterIncognito = incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists']['seenToday'].length - incognitoPatientLists[incognitoFacilityID['facilityID-incognito']]['PatientLists']['certedToday'].length;
                }
              } else {
                badgeCounterIncognito = 0;
              }
            } else {
              // set badgeCounterIncognito from value in memory and load non-incognito data to set badgeCounter
              badgeCounterIncognito = patientLists['seenToday'].length - patientLists['certedToday'].length;
              let facilityID = await chrome.storage.local.get('facilityID');
              if (facilityID['facilityID'] && facilityID !== facilityID['facilityID']) {
                let notIncogPtList = await chrome.storage.local.get(facilityID['facilityID']);
                if ((notIncogPtList[facilityID['facilityID']]['PatientLists'] && notIncogPtList[facilityID['facilityID']]['PatientLists']['date']) && notIncogPtList[facilityID['facilityID']]['PatientLists']['date'] === today) {
                  badgeCounter = notIncogPtList[facilityID['facilityID']]['PatientLists']['seenToday'].length - notIncogPtList[facilityID['facilityID']]['PatientLists']['certedToday'].length;
                }
              } else {
                badgeCounter = 0;
              }
            }
            badgeCounter += badgeCounterIncognito;
            await chrome.action.setBadgeTextColor({...(badgeCounter === 0 ? {color: 'white'} : {color: 'red'})});
            await chrome.action.setBadgeText({...(badgeCounter === 0 ? {text: ''} : {text: badgeCounter.toString()})});
            break;
        }
    }

    async function checkHealth() {
      Object.keys(lastHeartbeats).forEach(heartbeat => {
        // check if any heartbeats more than 30 seconds old
        healthStatus[heartbeat] = Date.now() - lastHeartbeats[heartbeat] <= 122000;
      })
      await chrome.storage.local.set({healthStatus: healthStatus});
      if (Object.values(healthStatus).some(value => !value)) {
        // if any healthStatus values are false set icond to red
        await chrome.action.setIcon({path:'icons/icon32-red.png'});
        return 'failed';
      } else {
        await chrome.action.setIcon({path:'icons/icon32-green.png'});
        return 'success';
      }
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
}

async function createOffscreenDocument() {
  const offscreenDocument = {
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Playing notification sounds',
  };
  if (await chrome.offscreen.hasDocument()) { return; }
  await chrome.offscreen.createDocument(offscreenDocument);
}

async function cleanUpSuspend() {
  if (options.sound) {
    await createOffscreenDocument();
    await chrome.runtime.sendMessage({type: 'play-sound', sound: 'healthcheckfail.mp3'}, response => {
      if (chrome.runtime.lastError) {
        console.log('error playing sound: ', chrome.runtime.lastError.message);
      }
    });
  }
  await chrome.action.setIcon({path:'icons/icon32.png'});
}