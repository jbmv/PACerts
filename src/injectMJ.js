// for getting and recording facility id and facility names use api/auth/login response and store as
// Object.keys(object['user']['facilities']).forEach(function (key) {
//     let facilityID = object['user']['facilities'][key]['id']
//     let facilityName = object['user']['facilities'][key]['name']
//     let message = {'facilityID': facilityID, 'facilityName': facilityName}
//     console.log(message);
// })
const extensionID = "pknjbljkccmnjiibcmjiefofiaopbcnl";
(function(xhr) {
    var XHR = XMLHttpRequest.prototype;
    var open = XHR.open;
    var send = XHR.send;
    var setRequestHeader = XHR.setRequestHeader;
    XHR.open = function(method, url) {
        this._method = method;
        this._url = url;
        this._requestHeaders = {};
        this._startTime = (new Date()).toISOString();
        return open.apply(this, arguments);
    };
    XHR.setRequestHeader = function(header, value) {
        this._requestHeaders[header] = value;
        return setRequestHeader.apply(this, arguments);
    };
    XHR.send = function(postData) {
        this.addEventListener('load', function() {
            var endTime = (new Date()).toISOString();
            var myUrl = this._url ? this._url.toLowerCase() : this._url;
            if(myUrl) {
                // if (myUrl.indexOf('icanhazip')) { return send.apply(this, arguments); } //skip these
                if ((myUrl.indexOf('open_orders') !== -1)) { let responseData = this.response; if (responseData) { processOpenOrdersResponse(responseData); }}
                if ((myUrl.indexOf('customers?') !== -1)) { let responseData = this.response; if (responseData) { processMJPatientResponse(responseData); }}
                if ((myUrl.indexOf('daily_transaction_report') !== -1)) { let responseData = this.response; if (responseData) { processMJDailyTransactionsResponse(responseData); }}
                if ((myUrl.indexOf('set_facility') !== -1)) { let responseData = this.response; if (responseData) { facilityIDMJSet(responseData); }}
                if ((myUrl.indexOf('login') !== -1)) { let responseData = this.response; if (responseData) { processLogin(responseData); }}
            }
        });
        return send.apply(this, arguments);
        // function definitions
        function processOpenOrdersResponse(responseData) {
            // MJ sends a JSON response with multiple orders of whoever is in the store at the moment
            if (responseData) {
                try {
                    const myObj = JSON.parse(responseData);
                    myObj.forEach((order) => {
                        // iterate through each order and send the data to background service worker
                        if (order.consumer_license) {
                            // Check if extension is installed
                            if (chrome && chrome.runtime) {
                                chrome.runtime.sendMessage(
                                    // external messages require extensionID
                                    extensionID,
                                    {
                                        apiCall: "MJ_open_orders",
                                        // conditionally add patient properties if they exist
                                        ...(order.hasOwnProperty('organization_id') && { organizationID: order.organization_id.toString() }),
                                        ...(order.hasOwnProperty('consumer_id') && { consumerID: order.consumer_id.toString() }),
                                        ...(order.hasOwnProperty('facility_id') && {facilityID: order.facility_id.toString() }),
                                        ...(order.hasOwnProperty('consumer_license') && { consumerLicense: order.consumer_license.toString() }),
                                        ...(order.hasOwnProperty('consumer_birth_date') && { birthDate: order.consumer_birth_date.substring(0, 10) }),
                                        ...(order.hasOwnProperty('consumer_name') && { compoundName: order.consumer_name }),
                                        // created_at property in MJ is in GMT even though it's not labeled as such
                                        ...(order.hasOwnProperty('created_at') && { orderTimeStamp: new Date(`${order.created_at} GMT`).getTime() }),
                                        ...(order.hasOwnProperty('created_at') && { orderDate: order.created_at.substring(0, 10) })
                                    }, function(response)  {
                                        if (chrome.runtime.lastError) {
                                            // reload page if message not received by background service worker
                                            console.log("InjectMJ: processOpenOrdersResponse response not heard, reloading page", chrome.runtime.lastError.message);
                                            window.location.reload();
                                        } else if (response) {
                                            console.log("injectMJ: received response : ", response);
                                        }
                                    })
                            }
                        }
                    })
                } catch (e) {
                    console.log("error parsing JSON:", e);
                }
            }

        }
        function processMJPatientResponse(responseData) {
            // MJ sends info for each patient that matches the search field -- we should just process and send all of them to background service worker
            try {
                const patientSearchResultsMJ = JSON.parse(responseData);
                if (patientSearchResultsMJ.results.length > 0) {
                    patientSearchResultsMJ.results.forEach((patient) => {
                        // process each patient object and send data to background service worker
                        if (chrome && chrome.runtime) {
                            // check if extension is installed
                            let message = {
                                // external messages require extensionID
                                extensionID,
                                apiCall: "MJ_patients",
                                ...(patient.hasOwnProperty('organization_id') && {'organization_id': patient.organization_id.toString()}),
                                ...(patient.hasOwnProperty('consumer_id') && {'consumerID': patient.consumer_id.toString()}),
                                ...(patient.hasOwnProperty('consumer_name') && {'compoundName': patient.consumer_name}),
                                ...(patient.hasOwnProperty('med_license_number_latest') && {'consumerLicense': patient.med_license_number_latest.toString()}),
                                ...(patient.hasOwnProperty('first_name') && {'firstName': patient.first_name}),
                                ...(patient.hasOwnProperty('last_name') && {'lastName': patient.last_name}),
                                ...(patient.hasOwnProperty('patient_state_id') && {'stateID': patient.patient_state_id.toString()}),
                                ...(patient.hasOwnProperty('birth_date') && {'birthDate': patient.birth_date.substring(0, 10)})
                            }
                            chrome.runtime.sendMessage(extensionID, message, function(response) {
                                if (chrome.runtime.lastError) {
                                    // reload page if message not heard
                                    console.log("InjectMJ: processMJPatientResponse:", chrome.runtime.lastError.message);
                                    window.location.reload();
                                } else if (response) {
                                    console.log("injectMJ processPatientResponse response received: ", response);
                                }
                            })
                        }
                    })
                }
            } catch (e) {
                console.log("error sending request:", e);
            }
        }
        function processMJDailyTransactionsResponse(responseData) {
            // MJ sends a list of transactions completed so far today, send patient data of each transaction to backround service worker
            let transactions = {};
            try {
                const myObj = JSON.parse(responseData);
                myObj.forEach((transaction) => {
                    // iterate through all transactions and send the data to background service worker
                    // sends { consumerID: compoundName }
                    if (transaction.consumer_id && transaction.consumer_name && transaction.order_date) {
                        transactions[transaction.consumer_id.toString()] = {
                            'compoundName': transaction.consumer_name,
                            'orderTimeStamp': new Date(transaction.order_date).getTime()
                        }
                    }
                })
                if (chrome && chrome.runtime) {
                    chrome.runtime.sendMessage(
                        // external messages require extensionID
                        extensionID,
                        {
                            apiCall: "MJ_daily_transaction_report",
                            transactions: transactions,
                        },
                        function (response) {
                            if (chrome.runtime.lastError) {
                                // reload page if message not heard
                                console.log("InjectMJ: processMJDailyTransactionsResponse:", chrome.runtime.lastError.message);
                                window.location.reload();
                            } else if (response) {
                                console.log("injectMJ processDailyTransactionsResponse recieved response:", response);
                            }
                        })
                }
            } catch (e) {
                console.log("error parsing JSON:", e);
            }
        }
        function facilityIDMJSet(responseData) {
            // User chose a new facility to log in to -- send facilityID to background service worker to reinitialize and load new facility data
            if (responseData) {
                try {
                    const myObj = JSON.parse(responseData);
                    if (myObj.environment.facility_id) {
                        // Check if extension is installed
                        if (chrome && chrome.runtime) {
                            chrome.runtime.sendMessage(
                                // external messages require extensionID
                                extensionID,
                                {
                                    apiCall: 'setFacilityID',
                                    facilityID: myObj.environment.facility_id.toString(),
                                }, function (response) {
                                    if (chrome.runtime.lastError) {
                                        console.warn("InjectMJ: facilityIDMJSet:", chrome.runtime.lastError.message);
                                    } else if (response) {
                                        console.log("injectMJ facilityIDMJSet recieved response:", response);
                                    }
                                })
                        }
                    }
                } catch (e) {
                    console.log("error parsing JSON:", e);
                }
            }

        }
        function processLogin(responseData) {
            // MJ sends facilityID and facilityName combinations in this response -- send these to background service worker to keep a mapping of this info for display purposes
            if (responseData) {
                try {
                    const myObj = JSON.parse(responseData);
                    let facilityIDToNameMap = {};
                    Object.keys(myObj['user']['facilities']).forEach(function (key) {
                        facilityIDToNameMap[myObj['user']['facilities'][key]['id']] = myObj['user']['facilities'][key]['name'];
                    })
                    if (chrome && chrome.runtime) {
                        chrome.runtime.sendMessage(
                            // external messages require extensionID
                            extensionID,
                            {
                                'apiCall': 'MJ_login',
                                'facilityIDToNameMap': facilityIDToNameMap
                            }, function (response) {
                                if (chrome.runtime.lastError) {
                                    console.warn("InjectMJ: facilityIDMJSet:", chrome.runtime.lastError.message);
                                } else if (response) {
                                    console.log("injectMJ facilityIDMJSet recieved response:", response);
                                }
                            })
                    }
                } catch (e) {
                    console.warn("error parsing JSON:", e);
                }
            }
        }
    };
})(XMLHttpRequest);
// Await document load and add listener if on patients page to process contentscript search text in react virtual DOM
// This had to be done by injection because content scripts do not have access to react javascript functions (setNativeValue in this case)
document.addEventListener('DOMContentLoaded', function(event) {
    currentUrl = window.location.href;
    if (currentUrl.indexOf('app.mjplatform.com/patients') !== -1) {
        let searchBoxClass = document.getElementsByClassName('form-control');
        let searchBox = searchBoxClass[0];
        if (searchBoxClass && searchBox) {
            searchBox.addEventListener('change', function(event) {
                console.log('search box changed -- attempting to update react native')
                let value = searchBox.value;
                setNativeValue(searchBox, value)
                searchBox.dispatchEvent(new Event('input', { bubbles: true }));
            })
        }
    }
    // function definitions
    function setNativeValue(element, value) {
        // attempt to set react virtual DOM text box once it has data pasted from content script
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
        if (valueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else {
            valueSetter.call(element, value);
        }
    }
})