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
            document.getElementById('activate-link').addEventListener('click', (e) => {
                chrome.runtime.sendMessage({'messageFunction': 'activate'},
                    function (response) {
                        if (chrome.runtime.lastError) {
                            console.log('activate: ', chrome.runtime.lastError);
                        } else if (response) {
                            console.log("activate: ", response);
                        }
                    })
                window.close();
            })
            document.getElementById('mj-login').addEventListener('click', (e) => {
                chrome.runtime.sendMessage({'messageFunction': 'activate'},
                    function (response) {
                        if (chrome.runtime.lastError) {
                            console.log('activate: ', chrome.runtime.lastError);
                        } else if (response) {
                            console.log("activate: ", response);
                        }
                    })
                chrome.tabs.create({url: 'https://app.mjplatform.com/login', active: true});
            })
        }
        async function formatPage() {
            let options = { 'autocert': false, 'openPages': false };
            if ((await chrome.storage.local.get('options')).hasOwnProperty('options')) {
                options = (await chrome.storage.local.get('options')).options;
            }
            // get facilityID
            const facilityID = await chrome.storage.local.get([facilityIDKey]);
            // Load data from local storage
            let data = await chrome.storage.local.get(facilityID[facilityIDKey]);
            let patientsSorted = getPatientsSorted(data);
            await drawTable(patientsSorted);
            await drawBanner();
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
            async function drawBanner() {
                let facilityDiv = document.getElementById('facility');
                let facility = facilityID['facilityID']
                if ((await chrome.storage.local.get('facilityIDToNameMap')).hasOwnProperty('facilityIDToNameMap')) {
                    facility = (await chrome.storage.local.get('facilityIDToNameMap')).facilityIDToNameMap[facilityID['facilityID']] ?? facility;
                }
                facilityDiv.innerHTML += " " + facility;
                let healthStatus = await chrome.storage.local.get(['healthStatus']);
                let banner = document.getElementById('banner');
                let mjp = document.getElementById('MJP-status');
                let mjq = document.getElementById('MJQ-status');
                let doh = document.getElementById('DOH-status');
                if (healthStatus['healthStatus'].mjSearch) { mjp.classList.remove('btn-danger'); mjp.classList.add('btn-success'); }
                if (healthStatus['healthStatus'].mjQueue) { mjq.classList.remove('btn-danger'); mjq.classList.add('btn-success'); }
                if (healthStatus['healthStatus'].doh) { doh.classList.remove('btn-danger'); doh.classList.add('btn-success'); }
                banner.classList.remove('d-none');
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
                    order: [[5, 'dsc']],
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
                                if (row.hasOwnProperty('stateID')) {
                                    return (row.hasOwnProperty('certData') && row.certData.disposition !== 'certed') ?  row.certData.disposition : 'View Certificate';
                                } else {
                                    return 'Search MJ'
                                }
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
                            visible: false,
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
                // fix for show completed row not aligned:
                let utilityRow = document.getElementById('to-cert-table_wrapper')
                utilityRow.firstChild.classList.add('mx-4');
                // insert button to mark selected rows as cert completed manually
                let markCompletedButton = document.createElement('button');
                markCompletedButton.setAttribute('id', 'mark-completed');
                markCompletedButton.setAttribute('class', 'btn btn-outline-secondary btn-sm d-none');
                markCompletedButton.innerHTML = 'Mark Completed';
                document.getElementById('mark-completed-div').appendChild(markCompletedButton);
                // replace the records per page with show completed checkbox
                let entriesPerPage = document.getElementsByClassName('dt-length')[0];
                entriesPerPage.innerHTML = `<label><input type="checkbox" id="showCompletedCheckbox"> Show Completed</label>`
                let showCompletedCheckbox = document.getElementById('showCompletedCheckbox');
                let autoCertToggle = document.getElementById('auto-cert-switch');
                autoCertToggle.checked = options.autoCert;
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
                                    console.warn('table click: error sending message: ', chrome.runtime.lastError);
                                } else if (response) {
                                    console.log("addButtonListeners received response: ", response);
                                }
                            })
                        if (message.action === 'openDOHpage') {
                            // any manual certing will stop the autoCert so that the page doesn't get updated while we are working
                            autoCertToggle.checked = false;
                            options.autoCert = false;
                            chrome.storage.local.set({ 'options':options })
                            window.close();
                        }
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
                    autoCertToggle.addEventListener('change', async function () {
                        options.autoCert = this.checked;
                        await chrome.storage.local.set({ 'options':options })
                    })
                    document.getElementById('MJQ-status').addEventListener('click', async function () {
                        let tabs = await chrome.tabs.query({url: '*://*.mjplatform.com/queue*'});
                        if (tabs.length === 0) {
                            await chrome.tabs.create({url: 'https://app.mjplatform.com/queue/payment', active: true});
                        } else {
                            await chrome.tabs.update(tabs[0].id, {active: true});
                            if (this.classList.contains('btn-danger')) {
                                await chrome.tabs.sendMessage(tabs[0].id, {'messageFunction': 'activate'});
                            }
                        }
                    })
                    document.getElementById('MJP-status').addEventListener('click', async function () {
                        let tabs = await chrome.tabs.query({url: '*://*.mjplatform.com/patients*'});
                        if (tabs.length === 0) {
                            await chrome.tabs.create({url: 'https://app.mjplatform.com/patients', active: true});
                        } else {
                            await chrome.tabs.update(tabs[0].id, {active: true});
                            if (this.classList.contains('btn-danger')) {
                                await chrome.tabs.sendMessage(tabs[0].id, {'messageFunction': 'activate'});
                            }
                        }
                    })
                    document.getElementById('DOH-status').addEventListener('click', async function () {
                        let tabs = await chrome.tabs.query({url: '*://*.padohmmp.custhelp.com/app/patient-certifications-med*'});
                        if (tabs.length === 0) {
                            await chrome.tabs.create({url: 'https://padohmmp.custhelp.com/app/patient-certifications-med', active: true});
                        } else {
                            await chrome.tabs.update(tabs[0].id, {active: true});
                            if (this.classList.contains('btn-danger')) {
                                await chrome.tabs.sendMessage(tabs[0].id, {'messageFunction': 'activate'});
                            }

                        }
                    })
                    // reload page if any local data changes occur
                    chrome.storage.local.onChanged.addListener((changes) => {
                        if (changes[facilityID['facilityID']] || changes['options'] || changes['healthStatus'] || changes['stateKey']) {
                            window.location.reload();
                        }
                    });
                }
            }
        }
    }
})
