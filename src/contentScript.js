/*
This content script does two things:
1. Inject script based on which webpage is current
2. Add listeners to respond to events from the extension and to send click events and data to the extension
 */
console.log('contentScript Starting');
// These must run before document loaded
// Contains code for script injection
let currentUrl = window.location.href;
//inject scripts:
if (currentUrl.indexOf('mjplatform.com') !== -1) {
  var s = document.createElement('script');
  s.src = chrome.runtime.getURL('injectMJ.js');
  s.onload = function () {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(s);
}
// if (currentUrl.indexOf('padohmmp.custhelp.com') !== -1) {
//     var s = document.createElement('script');
//     s.src = chrome.runtime.getURL('injectDOH.js');
//     s.onload = function () {
//         this.remove();
//     };
//     (document.head || document.documentElement).appendChild(s);
// }

//Await page load...
document.addEventListener('DOMContentLoaded', function () {
  // After page load
  currentUrl = window.location.href;
  main();
});

async function main() {
  // send wakeup message to service worker -- we can disregard a non-response here due to it may be sleeping
  await chrome.runtime.sendMessage({ message: 'wakeup' }, function (response) {
    if (chrome.runtime.lastError) {
      console.log(
        'wakeup sent from contentscript: ',
        chrome.runtime.lastError.message,
      );
    } else if (response) {
      console.info('wakeup sent: ', response);
    }
  });
  let currentUrl = window.location.href;
  if (currentUrl.indexOf('mjplatform.com') !== -1) {
    await loadedMJPage();
  }
  if (currentUrl.indexOf('patient-certifications-med') !== -1) {
    // load bootstrap from extension
    // let bsLink = document.createElement('link');
    // bsLink.rel = 'stylesheet';
    // bsLink.href = 'bootstrap/dist/css/bootstrap.min.css';
    // document.head.appendChild(bsLink);
    await loadedDOHPage();
  }
  addListeners();
  setInterval(sendHeartbeat, 25000); //keep service worker from going inactive by sending a message every 25 seconds
}

function addListeners() {
  chrome.runtime.onMessage.addListener(
    function (message, sender, sendResponse) {
      console.log('Received message for' + message.messageFunction);
      handleMessage(message, sender, sendResponse);
      sendResponse({ success: true });
    },
  );
}

function sendHeartbeat() {
  currentUrl = window.location.href;
  let message = {
    message: 'heartbeat',
  };
  if (currentUrl.indexOf('mjplatform.com') !== -1) {
    message.webPageFacilityName = getFacilityNameFromWebpage() ?? '';
  }
  try {
    chrome.runtime.sendMessage(message, function (response) {
      if (chrome.runtime.lastError) {
        console.warn(
          'Error sending heartbeat from content script: ',
          chrome.runtime.lastError.message,
        );
      } else if (response) {
        console.info('heartbeat heard: ', response);
      }
    });
  } catch (e) {
    console.warn('error sending message, reloading contentscript', e);
  }
}

async function loadedMJPage() {
  let facilityNameFromWebpage = getFacilityNameFromWebpage() ?? 'None';
  let message = { webPageFacilityName: facilityNameFromWebpage };
  chrome.runtime.sendMessage(message, function (response) {
    if (chrome.runtime.lastError) {
      console.log(
        'loadedMJPage(): failed to send message: ',
        chrome.runtime.lastError.message,
      );
    } else if (response) {
      console.log('loadedMJPage(): response received: ', response);
    }
  });
}

async function loadedDOHPage() {
  await chrome.runtime.sendMessage({ message: 'wakeup' }, function (response) {
    if (chrome.runtime.lastError) {
      console.log(
        'wakeup sent from contentscript: ',
        chrome.runtime.lastError.message,
      );
    } else if (response) {
      console.info('wakeup heard: ', response);
    }
  });
}

function waitForElement(elementID) {
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver((mutations, observer) => {
      const element = document.getElementById(elementID);
      if (element) {
        observer.disconnect(); // Stop observing
        resolve(element); // Resolve the promise with the element
      }
    });
    observer.observe(document.body, { childList: true, subtree: true }); // Start observing the document body for changes
  });
}

async function selectPatientInformation() {
  const element = await waitForElement('searchresultdata'); // Wait for the element to appear
  console.log('Element found:', element);
  // Now you can safely interact with the element
  let checkBoxes = document.getElementsByClassName('patients');
  checkBoxes[0].click();
}

function goToSectionSix() {
  let div1 = document.getElementById('1');
  let div7 = document.getElementById('7');
  div1.classList.remove('active');
  div7.classList.add('active');
}

function waitForSaveButton(consumerID, stateID) {
  const save = document.getElementsByClassName('medicalProfSave')[0];
  save.addEventListener('click', function () {
    // Code to execute when the button is clicked
    console.log(
      'Save button clicked! for consumerID and stateID',
      consumerID,
      stateID,
    );
    let message = {
      messageFor: 'background.js',
      messageSender: 'padoh',
      consumerID: consumerID,
      stateID: stateID,
    };
    chrome.runtime.sendMessage(message, function (response) {
      if (chrome.runtime.lastError) {
        console.warn(
          'waitForSaveButton: failed to send message:',
          chrome.runtime.lastError.message,
        );
      } else if (response) {
        console.log('waitForSaveButton(): response received: ', response);
      }
    });
  });
}

function getFacilityNameFromWebpage() {
  let container = document.getElementsByClassName('hidden-xs');
  if (container[0]) {
    return container[0].innerHTML.substring(
      document.getElementsByClassName('hidden-xs')[0].innerHTML.indexOf('-') +
        2,
    );
  }
}

async function handleMessage(message, sender, sendResponse) {
  if (message.messageFor !== 'contentScript.js') {
    return;
  }
  currentUrl = window.location.href;
  switch (message.messageFunction) {
    case 'getFacilityNameFromWebpage':
      let webPageFacilityName = getFacilityNameFromWebpage();
      if (webPageFacilityName) {
        sendResponse({
          success: true,
          webPageFacilityName: webPageFacilityName,
        });
      }
      sendResponse(sendResponse({ success: false }));
      break;
    case 'MJGetStateID':
      if (currentUrl.indexOf('app.mjplatform.com/patients') === -1) {
        sendResponse({ success: false });
        return;
      }
      let searchBoxClass = document.getElementsByClassName('form-control');
      let searchBox = searchBoxClass[0];
      if (searchBoxClass && searchBox) {
        // only run if on correct page and elements exit
        searchBox.value = message.textToPaste;
        searchBox.dispatchEvent(new Event('change', { bubbles: true }));
      }
      sendResponse(sendResponse({ success: false }));
      break;
    case 'DOHSearchPatient':
      if (currentUrl.indexOf('patient-certifications-med') === -1) {
        sendResponse({ success: false });
        return;
      }
      const consumerID = message.patient.consumerID;
      const stateID = message.patient.stateID;
      const lastName = message.patient.lastName;
      const birthDate = message.patient.birthDate;
      const stateIDBox = document.getElementById('rn_patientid');
      const lastNameBox = document.getElementById('rn_patient_lastname');
      const dobBox = document.getElementById('rn_patient_dob');
      if (stateIDBox && lastNameBox && dobBox) {
        // only run this code if we are on the cert page
        sendResponse({ success: true });
        stateIDBox.value = stateID;
        lastNameBox.value = lastName;
        dobBox.value = birthDate;
        let buttons = document.getElementsByClassName('btn-primary');
        if (buttons[0].innerHTML === 'Search Patient') {
          buttons[0].click();
        }
        // await searchAndOpenPatient();
        // console.log('search patient done');
        await selectPatientInformation();
        // await openActiveCert();
        await goToSectionSix();
        await waitForElement('7');
        let targetNode = document.getElementById('7');
        const observer = new MutationObserver((mutationsList, observer) => {
          for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
              console.log('A child node has been added or removed.');
              observer.disconnect();
              setTimeout(function() {
                // Code to be executed after 1 second
                let certData = getCertData();
                formatCertData(certData);
                noteTextArea = document.getElementById('dispensarynote');
                noteTextArea.focus();
              }, 1000);
            }
          }
        });
        const config = {
          attributes: true, // Observe changes to attributes
          childList: true, // Observe additions/removals of child nodes
          subtree: true, // Observe changes within the subtree
        };
        observer.observe(targetNode, config);
        waitForSaveButton(consumerID, stateID);
      }
      break;
    case 'DOHCertInfoSent':
      break;
    default:
      sendResponse(sendResponse({ success: false }));
  }
}

function getCertData() {
  let SMCs = {
    SMC_1: 'ALS',
    SMC_22: 'Anxiety',
    SMC_2: 'Autism',
    SMC_3: 'Cancer',
    SMC_24: 'Hepatitis C',
    SMC_4: 'Crohns',
    SMC_5: 'CNS damage',
    SMC_20: 'Movement Disorder',
    SMC_6: 'Epilepsy',
    SMC_7: 'Glaucoma',
    SMC_9: 'Huntingtons',
    SMC_10: 'IBD',
    SMC_11: 'Seizures',
    SMC_12: 'MS',
    SMC_18: 'Neurodegenerative',
    SMC_13: 'Neuropathies',
    SMC_21: 'Opiod Use Disorder',
    SMC_14: 'Parkinsons',
    SMC_8: 'HIV/AIDS',
    SMC_15: 'PTSD',
    SMC_16: 'Intractable pain',
    SMC_17: 'Sickle Cell',
    SMC_19: 'Terminal Illness',
    SMC_23: 'Tourettes',
  };
  let indications = [];
  let isFirstVisit = true;
  Object.keys(SMCs).forEach((key) => {
    let element = document.getElementById(key);
    if (element.checked) {
      indications.push(SMCs[key]);
    }
  });
  let list = document.getElementById('patientcertlist');
  let numberOfCerts = list.getElementsByTagName('tr').length - 1;
  if (numberOfCerts === 1) {
    let dispNotesTable = document.getElementById('insertDispNotesList');
    let numberOfNotes = dispNotesTable.rows.length - 1;
    if (numberOfNotes >= 1) { isFirstVisit = false; }
  } else { isFirstVisit = false; }
  let limitations = 'None';
  let limitationsCB = document.getElementById('anylimitation');
  if (limitationsCB.checked) {
    limitations = document.getElementById('anylimitationtext').value;
  }
  return {
    limitations: limitations,
    indications: indications,
    firstVisit: isFirstVisit,
  };
}

async function formatCertData(certData) {
  console.log(certData);
  let url = await chrome.runtime.getURL('DOHbanner.html');
  let banner = await fetch(url).then(res => res.text());
  let dispTextArea = document.getElementById('dispensarynote');
  let label = dispTextArea.previousElementSibling;
  label.insertAdjacentHTML('beforebegin', banner)


  let limitations = document.getElementById('limitations')
  let firstVisit = document.getElementById('first-visit');
  let indications = document.getElementById('indications');

  limitations.innerHTML = `Lmimitations: ${certData.limitations}`;
  firstVisit.innerHTML = '';

  limitations.innerHTML = "Limitations: " + certData.limitations;
  firstVisit.innerHTML = "First Visit: " + (certData.firstVisit ? "YES" : "No");
  indications.innerHTML = "Indications: " + certData.indications.join(", ");
}
