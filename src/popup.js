const facilityIDToFacilityNameLUT = {
    '1238': 'Lawrenceville',
    '2641': 'Montgomeryville'
}
let allPatientData = {};
let patientsSeen = [];
let patientsCerted = [];
let facilityID = '';
let date = new Date();
let viewCerted = false;
const isIncognitoMode = chrome.extension.inIncognitoContext;
const stateKey = isIncognitoMode ? 'state-incognito' : 'state';
const facilityIDKey = isIncognitoMode ? 'facilityID-incognito' : 'facilityID';
document.addEventListener('DOMContentLoaded', function () {
    main();
})
async function main() {
    await chrome.runtime.sendMessage({message: 'wakeup'}, function (response) {
        if (chrome.runtime.lastError) {
            console.log('wakeup sent from contentscript: ', chrome.runtime.lastError.message);
        } else if (response) {
            console.info("wakeup heard: ", response);
        }
    });
    let state = await chrome.storage.local.get([stateKey]);
    switch (state[stateKey]) {
        case 'initializing': noFacilitySet(); break;
        case 'running': await loadData(); break;
        default: noFacilitySet(); break; //state invalid
    }
}
function noFacilitySet() {
    document.getElementById('no-facility-set').classList.remove('d-none');
    // const dropdownItems = document.querySelectorAll('.dropdown-item');
    // dropdownItems.forEach(item => {
    //     item.addEventListener('click', function(e) {
    //         e.preventDefault(); // Prevent the default link behavior
    //         const location = this.textContent; // Get the text of the selected item
    //         // Do something with the selected value
    //         console.log("Selected: " + location);
    //         chrome.runtime.sendMessage({
    //             'messageSender': 'initializeExtension',
    //             'location': location
    //         });
    //         // Update the dropdown button text
    //         const dropdownButton = this.closest('.dropdown').querySelector('.dropdown-toggle');
    //         dropdownButton.textContent = location;
    //         //reload window
    //         window.location.reload();
    //     });
    // });
}
async function loadData() {
    console.log("loading data");
    let patientsNEEDINGCERTED = [];
    let dataToFormat = [];
    document.getElementById("table-container").innerHTML = ""
    chrome.storage.local.get(facilityIDKey).then(facID => {
        facilityID = facID[facilityIDKey];
        chrome.storage.local.get(facilityID).then(data => {
            let date = new Date();
            let today = date.getFullYear() + "-" + String((date.getMonth() + 1)).padStart(2, '0') + "-" + String(date.getDate()).padStart(2, '0');
            let listDate = data[facilityID]['PatientLists']['date']
            if (listDate !== today) { console.log('lists out of date, displaying message'); listsOutOfDate(listDate); return; }
            allPatientData = data[facilityID]['Patients'];
            patientsSeen = data[facilityID]['PatientLists']['seenToday'];
            patientsCerted = data[facilityID]['PatientLists']['certedToday'];
            patientsNEEDINGCERTED = patientsSeen.filter(patient => !patientsCerted.includes(patient));
            switch (viewCerted) {
                case true:
                    patientsCerted.forEach((id) => {
                        dataToFormat.push(allPatientData[id]);
                    })
                    break;
                case false:
                    patientsNEEDINGCERTED.forEach(id => {
                        dataToFormat.push(allPatientData[id]);
                    })
                    break;
            }
            formatPage(listDate,dataToFormat);
            addListeners();
        })
    })
}
async function formatPage(listDate,dataToFormat) {
    let header = document.getElementById('totals-header');
    let facility = facilityIDToFacilityNameLUT[facilityID] ?? facilityID;
    let facilityDiv = document.getElementById('facility-div');
    let seenDiv = document.getElementById('seen-div');
    let certedDiv = document.getElementById('certed-div');
    let dateDiv = document.getElementById('date-div');
    facilityDiv.innerHTML = `<b>Facility: </b>${facility}`;
    seenDiv.innerHTML = `<b>Patients Total: </b>${patientsSeen.length}`;
    certedDiv.innerHTML = `<b>Patients Certed: </b>${patientsCerted.length}`;
    dateDiv.innerHTML = listDate;
    header.classList.remove('d-none');
    let table = formatTable(dataToFormat);
    table.setAttribute("id", "myTable");
    table.setAttribute("class", "table table-sm table-hover");
    document.getElementById("table-container").appendChild(table);
    document.getElementById('stats').classList.remove('d-none');
    document.getElementById('table-container').classList.remove('d-none');
}
function formatTable(dataToFormat) {
    console.log("formatting Table with: " + dataToFormat);
    const itemsToDisplay = ["Name", "Status", "Actions"];
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const body = document.createElement("tbody");
    const headerRow = document.createElement("tr");
    //header section
    itemsToDisplay.forEach(item => {
        const header = document.createElement("th");
        header.textContent = item;
        headerRow.appendChild(header);
    })
    head.appendChild(headerRow);
    table.appendChild(head);
    //row sections
    //switch on viewCerted toggle
    switch (viewCerted) {
        case true:
            dataToFormat.forEach(patient => {
                let key = patient.consumerID;
                let actions = ["View Certificate"];
                let status = "Cert Reviewed";
                const row = document.createElement("tr");
                row.setAttribute("id", key); // set row ID to consumerID for use in onClick listener
                // name cell
                let cell = document.createElement("td");
                cell.classList.add("align-middle");
                cell.textContent = patient.compoundName;
                row.appendChild(cell);
                // status cell
                cell = document.createElement("td");
                cell.classList.add("align-middle");
                cell.textContent = status;
                row.appendChild(cell);
                // action cell
                cell = document.createElement("td");
                cell.classList.add("align-middle");
                let div = document.createElement("div");
                div.setAttribute("class", "'d-flex gap-3'");
                actions.forEach(action => {
                    button = document.createElement('button');
                    button.innerHTML = action;
                    button.id = `${key}-${action}`;
                    button.setAttribute('class','buttonForActions btn btn-link link-secondary btn-sm');
                    // next code block formats buttons based on actions -- looked ugly so removed
                    // switch (action) {
                    //     case 'Mark Certed': button.classList.add('btn-outline-danger'); break;
                    //     case 'Get State ID': button.classList.add('btn-outline-secondary'); break;
                    //     case 'View Certificate': button.classList.add('btn-outline-success'); break;
                    //     case 'Lookup By Name': button.classList.add('btn-outline-warning'); break;
                    // }
                    div.appendChild(button);
                })
                cell.appendChild(div);
                row.appendChild(cell);
                body.appendChild(row);
                table.appendChild(body);
            })
            break;
        case false:
            dataToFormat.forEach(patient => {
                let key = patient.consumerID;
                let actions = ["Mark Certed"];
                let status = "";
                const row = document.createElement("tr");
                row.setAttribute("id", key); // set row ID to consumerID for use in onClick listener
                if (!patient.stateID && patient.consumerLicense) { actions.push("Get State ID"); status = "Awaiting State ID"; }
                if (!patient.stateID && !patient.consumerLicense) { actions.push("Lookup By Name"); status = "Missed"; }
                if (patient.stateID) { actions.push("View Certificate"); status = "Ready to Cert"; }
                // name cell
                let cell = document.createElement("td");
                cell.classList.add("align-middle");
                cell.textContent = patient.compoundName;
                row.appendChild(cell);
                // status cell
                cell = document.createElement("td");
                cell.classList.add("align-middle");
                cell.textContent = status;
                row.appendChild(cell);
                // action cell
                cell = document.createElement("td");
                cell.classList.add("align-middle");
                let div = document.createElement("div");
                div.setAttribute("class", "'d-flex gap-3'");
                actions.forEach(action => {
                    button = document.createElement('button');
                    button.innerHTML = action;
                    button.id = `${key}-${action}`;
                    button.setAttribute('class','buttonForActions btn btn-link link-secondary btn-sm');
                    // next code block formats buttons based on actions -- looked ugly so removed
                    // switch (action) {
                    //     case 'Mark Certed': button.classList.add('btn-outline-danger'); break;
                    //     case 'Get State ID': button.classList.add('btn-outline-secondary'); break;
                    //     case 'View Certificate': button.classList.add('btn-outline-success'); break;
                    //     case 'Lookup By Name': button.classList.add('btn-outline-warning'); break;
                    // }
                    div.appendChild(button);
                })
                cell.appendChild(div);
                row.appendChild(cell);
                body.appendChild(row);
                table.appendChild(body);
            });
            break;
    }
    return table;
}
function addListeners() {
    let viewCertedToggleButton = document.getElementById("view-certed-toggle-button");
    viewCertedToggleButton.addEventListener("click", function() {
        toggleViewCerted();
    })
    addTableButtonListeners();
    addDataListeners();
}
function addTableButtonListeners() {
    const allButtons = document.getElementsByClassName("buttonForActions");
    const buttonList = Array.from(allButtons);
    buttonList.forEach(button => {
        button.addEventListener('click', async function (event) {
            const buttonID = event.target.id;
            const consumerID = buttonID.split('-')[0];
            const action = buttonID.split('-').pop();
            const textToCopy = allPatientData[consumerID].consumerLicense ?? allPatientData[consumerID].compoundName;
            await navigator.clipboard.writeText(textToCopy);
            let message = {
                'messageFor': 'background.js',
                'messageSender': 'popUpClick',
                'consumerID': consumerID,
                'textToPaste': textToCopy,
                'action': action,
            }
            if (action === 'Mark Certed') { if (!confirm("Mark this patient as certed manually?")) {
                    return;
                } }
            await chrome.runtime.sendMessage(message,
                function (response) {
                if (chrome.runtime.lastError) {
                    console.warn('addTableButtonListeners: error sending message: ', chrome.runtime.lastError);
                } else if (response) {
                    console.log("addTableButtonListeners received response: ", response);
                }
            })
            if (action !== 'Mark Certed') { window.close(); }
        })
    })
}
function addDataListeners() {
    chrome.storage.onChanged.addListener(function(changes, namespace) {
        for (var key in changes) {
            if (namespace === 'local' && key === facilityID) {
                console.log('data changed, reloading');
                chrome.storage.onChanged.removeListener();
                loadData();
            }
        }
    }) }
function listsOutOfDate(listDate) {
    document.getElementById('outOfDate').classList.remove('d-none');
}
function toggleViewCerted() {
    if (viewCerted === true) { window.location.reload(); }
    viewCerted = !viewCerted;
    let button = document.getElementById("view-certed-toggle-button");
    button.innerHTML = '< Back'
    chrome.storage.onChanged.removeListener();
    loadData();
}
