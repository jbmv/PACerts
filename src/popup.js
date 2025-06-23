


document.addEventListener("DOMContentLoaded", function(e) {
    // wrapper function to make await/async calls after DOM loaded
    main();
    async function main() {
        let date = new Date();
        let today = date.getFullYear() + '-' + String((date.getMonth() + 1)).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
        // wake up background service worker in case it was asleep
        await chrome.runtime.sendMessage({message: 'wakeup'}, function (response) {
            if (chrome.runtime.lastError) {
                // no need to warn, just sending wakeup in case it's inactive
                console.log('wakeup not received by background.js ', chrome.runtime.lastError.message);
            } else if (response) {
                console.info('wakeup sent: ', response);
            }
        });
        // check if incognito mode and set stateKey and facilityIDKey for use in loading local storage keys
        const isIncognitoMode = chrome.extension.inIncognitoContext;
        const stateKey = isIncognitoMode ? 'state-incognito' : 'state';
        const facilityIDKey = isIncognitoMode ? 'facilityID-incognito' : 'facilityID';
        let state = await chrome.storage.local.get([stateKey]);
        // format page depending on state of extention
        switch (state[stateKey]) {
            case 'initializing':
                extensionNotInitialized();
                break;
            case 'running':
                await formatPage();
                break;
            default:
                extensionNotInitialized();
                break;
        }
        //function definitions
        function extensionNotInitialized() {
            document.getElementById('extension-not-initialized').classList.remove('d-none');
        }
        async function formatPage() {
            // draw banner first -- this doesn't get reloaded on data change
            drawBanner();
            // get facilityID
            const facilityID = await chrome.storage.local.get([facilityIDKey]);
            // Load data from local storage
            let data = await chrome.storage.local.get(facilityID[facilityIDKey]);
            let patientsSorted = getPatientsSorted(data);
            await drawTable(patientsSorted);
            document.getElementById('footer').classList.remove('d-none');

            // function definitions -- helper functions
            function getPatientsSorted(data) {
                let allPatientData = data[facilityID[facilityIDKey]]['Patients'];
                let patientsSeenList = data[facilityID[facilityIDKey]]['PatientLists']['seenToday'];
                let patientsCertedList = data[facilityID[facilityIDKey]]['PatientLists']['certedToday'];
                let patientObjectsSorted = {
                    seenToday: [],
                    certedToday: [],
                    needsCerted: [],
                }
                // iterate through patients we've seen today -- remember these are arrays of consumerIDs and wee need the actual patient objects for data table
                patientsSeenList.forEach((patient) => {
                    // add all of these patient objects to the sorted object
                    patientObjectsSorted['seenToday'].push(allPatientData[patient]);
                    if (!patientsCertedList.includes(patient)) {
                        // if this patient isn't in the certed list, add it to the needsCerted property of the sorted object
                        patientObjectsSorted["needsCerted"].push(allPatientData[patient]);
                    } else {
                        // this patient has been certed so add object to certedToday property of sorted object
                        patientObjectsSorted['certedToday'].push(allPatientData[patient]);
                    }
                })
                return patientObjectsSorted;
            }
            function drawBanner() {

            }
            async function drawTable(patientsSorted) {
                // clear the table if already exists and we are redrawing do to data change
                // document.getElementById('to-cert-table').innerHTML = '';
                // create table with DataTables framework
                let table = new DataTable('#to-cert-table', {
                    pageLength: 10,
                    select: {
                        style: 'multi',
                        headerCheckbox: 'select-page',
                        selector: 'td:first-child',
                        // headerCheckbox: false
                    },
                    order: [[5, 'asc']],
                    columns: [
                        {
                            width: 80,
                            data: null,
                            orderable: false,
                            render: DataTable.render.select()
                        },
                        {
                            width: 150,
                            data: 'compoundName',
                            title: 'Name'
                        },
                        {
                            data: 'certData',
                            title: 'Cert Notes',
                            width: 350,
                            render: function (data, type, row) {
                                if (row.hasOwnProperty('certData') && row.certData.date === today) {
                                    let text = '';
                                    let limitationsToIgnore = ['None','none','no'];
                                    if (!limitationsToIgnore.includes(row.certData.limitations.trim())) {text += `Limitations: ${row.certData.limitations}!   `;}
                                    if (row.certData.firstVisit === true) {text += `First Visit!   `;}
                                    text += `Indications: ${row.certData.indications.join(", ")}   `;
                                    return text;
                                } else { return ''; }
                            }
                        },
                        {
                            data: 'stateID',
                            title: 'Status',
                            class: 'status btn btn-link link-secondary btn-sm',
                            render: function (data, type, row) {
                                if (patientsSorted.certedToday.includes(row)) { return 'Completed' }
                                return (row.hasOwnProperty('stateID')) ? 'View Certificate' : 'Search MJ';
                            }
                        },
                        {
                            // this column is used to determine if we display people with completed certs -- not visible on page
                            data: null,
                            title: 'isCerted',
                            visible: false,
                            render: function (data, type, row) {
                                return patientsSorted.certedToday.includes(data);
                            }
                        },
                        {
                            // this column is to sort by newest -- default sort, this column is not visible
                            data: 'orderTimeStamp',
                            title: 'Time Stamp',
                            visible: true,
                        }
                    ],
                    data: patientsSorted.seenToday
                });
                // initially show only patients that haven't been certed today
                table.column(4).search('false').draw();
                // fix for the select all box is in the wrong spot!
                let selectAll = document.getElementsByClassName('dt-column-header')[0];
                selectAll.style.setProperty('justify-content', 'center');
                selectAll.firstChild.remove();
                selectAll.firstChild.remove();
                // insert button to mark selected rows as cert completed manually
                let markCompletedButton = document.createElement('button');
                markCompletedButton.setAttribute('id', 'mark-completed');
                markCompletedButton.setAttribute('class', 'btn btn-outline-secondary btn-sm');
                markCompletedButton.innerHTML = 'Mark Completed';
                document.getElementById('mark-completed-div').appendChild(markCompletedButton);
                // replace the records per page with show completed checkbox
                let entriesPerPage = document.getElementsByClassName('dt-length')[0];
                entriesPerPage.innerHTML = `<label><input type="checkbox" id="showCompletedCheckbox"> Show Completed</label>`
                let showCompletedCheckbox = document.getElementById('showCompletedCheckbox');
                addListeners(table, markCompletedButton, showCompletedCheckbox);
                //function definitions
                function addListeners() {
                    table.on("click", ".status", function () {
                        let data = table.row(this).data(); // Get the data of the clicked row
                        let message = {
                            'messageFor': 'background.js',
                            'messageSender': 'popUpClick',
                            'consumerID': data.consumerID,
                            'searchTextforMJ': data.compoundName,
                            // action -- we are either sending the textToPaste to MJ or we are opening the PA DOH page with the stateID
                            'action': data.stateID ? 'openDOHpage' : 'openMJPatientPage',
                        }
                        chrome.runtime.sendMessage(message,
                            function (response) {
                                if (chrome.runtime.lastError) {
                                    console.warn('addButtonListeners: error sending message: ', chrome.runtime.lastError);
                                } else if (response) {
                                    console.log("addButtonListeners received response: ", response);
                                }
                            })
                        if (message.action === 'openDOHpage') { window.close(); }
                    });
                    table.on("change", "input[type='checkbox']", function() {
                        if (table.rows({ selected: true }).data().length > 0) {
                            markCompletedButton.classList.remove('d-none');
                        } else {
                            markCompletedButton.classList.add('d-none');
                        }
                    });
                    markCompletedButton.addEventListener('click', function(e) {
                        if (!confirm("Mark checked patients as manually certed? This cannot be undone.")) { return; }
                        let message = {
                            'messageFor': 'background.js',
                            'messageSender': 'popUpClick',
                            'action': 'markCerted',
                            'certed': [],
                        }
                        let selectedRows = table.rows({ selected: true }).data();
                        for (let i = 0; i < selectedRows.length; i++) {
                            message.certed.push(selectedRows[i].consumerID);
                        }
                        chrome.runtime.sendMessage(message, function (response) {
                            if (chrome.runtime.lastError) {
                                console.warn('markCerted: error sending message: ', chrome.runtime.lastError);
                            } else if (response) {
                                console.log('markCerted: message success', response);
                            }
                        })
                    })
                    showCompletedCheckbox.addEventListener('change', async function () {
                        if (this.checked) {
                            table.column(4).search('').draw(); // Clear any existing filter on the isCerted column
                        } else {
                            table.column(4).search('false').draw();
                        }
                    })
                    // reload page if any local data changes occur
                    chrome.storage.local.onChanged.addListener((changes) => {
                        if (changes[facilityID[facilityIDKey]]) {
                            window.location.reload();
                        }
                    });
                }
            }
        }
    }
})
