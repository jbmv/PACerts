const isIncognitoMode = chrome.extension.inIncognitoContext;
const facilityIDKey = isIncognitoMode ? 'facilityID-incognito' : 'facilityID';
const stateKey = isIncognitoMode ? 'state-incognito' : 'state';

// default options before loading from storage
let options = { 'autocert': false }
let limitationsToIgnore = ['None','none','no'];

// Await document load
document.addEventListener('DOMContentLoaded', function () {
    // After page load
    chrome.runtime.onMessage.addListener(handleStateChange);
    chrome.storage.local.get(stateKey).then(state => {
        if (state['state'] !== 'await activation') {
            main();
        }
    })
});

async function handleStateChange(message) {
    if (message.messageFunction === 'activate') {
        window.location.reload();
    }
}

async function main() {
    if ((await chrome.storage.local.get('options')).hasOwnProperty('options')) {
        options = (await chrome.storage.local.get('options')).options;
    }
    await sendHeartbeat();
    // add listeners for internal messages and options changes
    chrome.storage.local.onChanged.addListener(async (changes) => {
        if (changes['options']) {
            if ((await chrome.storage.local.get('options')).hasOwnProperty('options')) {
                options = (await chrome.storage.local.get('options')).options;
            }
        }
    });
    chrome.runtime.onMessage.addListener(handleInternalMessage);
    // send heartbeat to service worker every 25 seconds to keep it from going inactive
    setInterval(sendHeartbeat, 25000);
    // function definitions
    function handleInternalMessage(message, sender, sendResponse) {
        console.log(`contentScriptDOH received message for: ${message.messageFunction} initiated by ${message.initiator}`);
        switch (message.messageFunction) {
            case 'DOHSearchPatient':
                searchPatientDOH(message);
                break;
            case 'DOHCertInfoSent':
                break;
            default:
                sendResponse(sendResponse({ success: false }));
        }
        sendResponse({ success: true });
        // function definitions
        async function searchPatientDOH(message) {
            const consumerID = message.patient.consumerID;
            const stateID = message.patient.stateID;
            const lastName = message.patient.lastName;
            const birthDate = message.patient.birthDate;
            const stateIDBox = document.getElementById('rn_patientid');
            const lastNameBox = document.getElementById('rn_patient_lastname');
            const dobBox = document.getElementById('rn_patient_dob');
            // reload page if these boxes aren't empty -- means we left the page in an invalid state
            if (stateIDBox.value !== '' || lastNameBox.value !== '' || dobBox.value !== '') { window.location.reload(); }
            if (stateIDBox && lastNameBox && dobBox) {
                // only run this code if we are on the cert page
                sendResponse({'DOHSearchPatient': 'success'});
                // set values for search box
                stateIDBox.value = stateID;
                lastNameBox.value = lastName;
                dobBox.value = birthDate;
                // click Search Patient button
                let buttons = document.getElementsByClassName('btn-primary');
                if (buttons[0].innerHTML === 'Search Patient') {
                    buttons[0].click();
                }
                // select patient from list of patients (there's only ever one)
                let loadingDivs = await createLoadingSpinner();
                await selectPatientInformation();
                await selectActiveCert();
                await goToSectionSix();
                await waitForElement('7');
                let targetNode = document.getElementById('7');
                const observer = new MutationObserver((mutationsList, observer) => {
                    for (const mutation of mutationsList) {
                        if (mutation.type === 'childList') {
                            observer.disconnect();
                            setTimeout(function () {
                                // Code to be executed after 1 second -- need to wait for all cert data to be returned from xhttp request
                                let certData = getCertData();
                                let date = new Date();
                                let searchDate = String((date.getMonth() + 1)).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0') + '-' + date.getFullYear();
                                let alreadyCertedToday = patientAlreadyCertedToday('insertDispNotesList',1,searchDate)
                                formatCertData(certData,alreadyCertedToday);
                                let noteTextArea = document.getElementById('dispensarynote');
                                noteTextArea.focus();
                                loadingDivs.forEach((div) => {
                                    div.remove();
                                })
                                // everything is done and formatted -- wait for save button to be clicked to send message back to background service worker to mark patient as certed
                                waitForSaveButtonClick(consumerID, stateID, certData);
                                // if autoCert is active, click the save button programatically after setting textArea to signature
                                if (message.initiator === 'autoCert' && options.autoCert === true) {
                                    if (!alreadyCertedToday
                                        && limitationsToIgnore.includes(certData.limitations.trim().toLowerCase())
                                        && certData.firstVisit === false
                                        && certData.indications.length > 0) {
                                        noteTextArea.value = "   "; //TODO: replace this hard-coded 'reviewed' with signoff from options
                                        console.log('padoh: auto-certing: ', consumerID);
                                        const save = document.getElementsByClassName('medicalProfSave')[0];
                                        save.click();
                                        // reload page for new patient
                                        window.location.reload();
                                    } else {
                                        let certProblem = 'Problem with Cert';
                                        if (alreadyCertedToday) { certProblem = 'Already Certed Today'; }
                                        if (!limitationsToIgnore.includes(certData.limitations.trim().toLowerCase())) { certProblem = 'Limitations'; }
                                        if (certData.firstVisit) { certProblem = 'First Visit'; }
                                        if (certData.indications.length === 0) { certProblem = 'Missing Indication'; }
                                        certData.disposition = certProblem;
                                        let message = {
                                            messageFor: 'background.js',
                                            messageSender: 'padoh',
                                            consumerID: consumerID,
                                            stateID: stateID,
                                            certData: certData,
                                        };
                                        chrome.runtime.sendMessage(message, function (response) {
                                            if (chrome.runtime.lastError) {
                                                console.warn(
                                                    'autocert: failed to send message:',
                                                    chrome.runtime.lastError.message,
                                                );
                                            } else if (response) {
                                                console.log('autoCert: response received: ', response);
                                            }
                                        });
                                        // reload page for new patient
                                        window.location.reload();
                                    }
                                }
                            }, 1000);
                        }
                    }
                });
                const config = {
                    attributes: true, // Observe changes to attributes
                    childList: true, // Observe additions/removals of child nodes
                    subtree: true, // Observe changes within the subtree
                };
                await observer.observe(targetNode, config);
            } else {
                sendResponse({'DOHSearchPatient': 'failed -- element not present...logged in?'});
            }
            // function definitions
            async function selectPatientInformation() {
                return new Promise(async resolve => {
                    // Wait for the element that contains the patient info to appear and click the first box (there's only ever 1 patient returned)
                    await waitForElement('searchresultdata');
                    let checkBoxes = document.getElementsByClassName('patients');
                    checkBoxes[0].click();
                    resolve('success');
                })
            }
            async function selectActiveCert() {
                // wait 1 second for certs to load
                setTimeout(function () {
                    let certificateCheckboxes = document.querySelectorAll("td[id*='CertificateStatus']")
                    for (const checkbox of certificateCheckboxes) {
                        if (checkbox.innerHTML === 'Active') { checkbox.nextElementSibling.firstElementChild.click(); break;}
                    }
                },1000)
            }
            function goToSectionSix() {
                let div1 = document.getElementById('1');
                let div7 = document.getElementById('7');
                div1.classList.remove('active');
                div7.classList.add('active');
            }
            function waitForElement(elementID) {
                return new Promise((resolve) => {
                    const observer = new MutationObserver((mutations, observer) => {
                        const element = document.getElementById(elementID);
                        // if element exists, resolve promise
                        if (element) {
                            observer.disconnect(); // Stop observing
                            resolve(element); // Resolve the promise with the element
                        }
                    });
                    observer.observe(document.body, {childList: true, subtree: true}); // Start observing the document body for changes
                });
            }
            function getCertData() {
                let date = new Date();
                let today = date.getFullYear() + '-' + String((date.getMonth() + 1)).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
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
                    if (numberOfNotes >= 1) {
                        isFirstVisit = false;
                    }
                } else {
                    isFirstVisit = false;
                }
                let limitations = 'None';
                let limitationsCB = document.getElementById('anylimitation');
                if (limitationsCB.checked) {
                    limitations = document.getElementById('anylimitationtext').value;
                }
                return {
                    date: today,
                    limitations: limitations,
                    indications: indications,
                    firstVisit: isFirstVisit,
                };
            }
            async function formatCertData(certData,alreadyCertedToday) {
                console.log(certData);
                let url = chrome.runtime.getURL('DOHbanner.html');
                let banner = await fetch(url).then(res => res.text());
                let dispTextArea = document.getElementById('dispensarynote');
                let label = dispTextArea.previousElementSibling;
                label.insertAdjacentHTML('beforebegin', banner)
                if (alreadyCertedToday) {
                    let alreadyCertedDiv = document.getElementById('already-certed-today');
                    alreadyCertedDiv.classList.remove('hidden');
                }
                let limitations = document.getElementById('limitations')
                let firstVisit = document.getElementById('first-visit');
                let indications = document.getElementById('indications');
                limitations.innerHTML = "Limitations: " + certData.limitations;
                firstVisit.innerHTML = "First Visit: " + (certData.firstVisit ? "YES" : "No");
                indications.innerHTML = "Indications: " + certData.indications.join(", ");
                if (!limitationsToIgnore.includes(certData.limitations.trim().toLowerCase())) { limitations.classList.add('mark'); limitations.setAttribute('style', "font-weight: bolder; color: red;");}
                if (certData.firstVisit) { firstVisit.classList.add('mark'); firstVisit.setAttribute('style', "font-weight: bolder; color: red;");}
                if (certData.indications.length === 0) { indications.classList.add('mark'); indications.setAttribute('style', "font-weight: bolder; color: red;");}
            }
            function patientAlreadyCertedToday(tableId, columnIndex, searchTerm) {
                    // Get the table element by its ID.
                    const table = document.getElementById(tableId);
                    // If the table doesn't exist, exit the function.
                    if (!table) {
                        console.error(`Table with ID "${tableId}" not found.`);
                        return true;
                    }
                    // Get all table rows, excluding the header (thead) if present.
                    const rows = table.querySelectorAll('tbody tr'); // Assuming a tbody is used.
                    // Convert the search term to lowercase for case-insensitive comparison.
                    const lowerCaseSearchTerm = searchTerm.toLowerCase();
                    // Iterate through each table row.
                for (const row of rows) {
                    // for...of used because we want to break after first return and .forEach does not allow that
                    // Get all cells within the current row.
                    const cells = row.cells;
                    // Check if the specified column index is valid.
                    if (columnIndex >= 0 && columnIndex < cells.length) {
                        // Get the text content of the cell in the specified column.
                        const cellText = cells[columnIndex].textContent.toLowerCase();
                        // Check if the cell content contains the search term.
                        if (cellText.includes(lowerCaseSearchTerm)) {
                            // If there's a match, return true.
                            return true;
                        }
                    }
                }
                return false;
            }
            function waitForSaveButtonClick(consumerID, stateID, certData) {
                // listen for the save button to be clicked, then tell background service worker to mark the patietn certed
                const save = document.getElementsByClassName('medicalProfSave')[0];
                save.addEventListener('click', function () {
                    // Code to execute when the button is clicked
                    console.log(
                        'Save button clicked! for consumerID and stateID',
                        consumerID,
                        stateID,
                    );
                    certData.disposition = 'certed'
                    let message = {
                        messageFor: 'background.js',
                        messageSender: 'padoh',
                        consumerID: consumerID,
                        stateID: stateID,
                        certData: certData,
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
                    // reload page for new patient
                    window.location.reload();
                });
            }
            async function createLoadingSpinner() {
                let spinnerDiv = document.createElement("div");
                spinnerDiv.className = 'loadingSpinner';
                let greyDiv = document.createElement("div");
                greyDiv.className = 'loadingGrey';
                let rnWindow = document.getElementById('rn_Window');
                rnWindow.insertAdjacentElement('afterbegin', greyDiv);
                greyDiv.insertAdjacentElement('afterbegin', spinnerDiv);
                return [greyDiv, spinnerDiv];
            }
        }
    }
    function sendHeartbeat() {
        let currentURL = window.location.href;
        let message = {
            'message': 'heartbeat',
            'messageSender': 'DOH content script',
            'url': currentURL,
            'timeStamp': Date.now()
        };
        try {
            chrome.runtime.sendMessage(message, function (response) {
                if (chrome.runtime.lastError) {
                    console.log(
                        'Error sending heartbeat from content script: ',
                        chrome.runtime.lastError.message,
                    );
                } else if (response) {
                    console.info('heartbeat heard: ', response);
                }
            });
        }
        catch (e) {
            console.log('error sending heartbeat: ', e);
        }
    }
}