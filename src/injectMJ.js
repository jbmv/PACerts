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
            }
        });
        return send.apply(this, arguments);
    };
})(XMLHttpRequest);
function processOpenOrdersResponse(responseData) {
    if (responseData) {
        try {
            const myObj = JSON.parse(responseData);
            myObj.forEach((item) => {
                if (item.consumer_license) {
                    // Check if extension is installed
                    if (chrome && chrome.runtime) {
                        // Make a request:
                        let facilityIDFromWebpage = getFacilityNameFromWebpage();
                        chrome.runtime.sendMessage(
                            extensionID,
                            {
                                endPoint: "MJ_open_orders",
                                webPageFacilityName: facilityIDFromWebpage,
                                organizationID: item.organization_id.toString(),
                                consumerID: item.consumer_id.toString(),
                                facilityId: item.facility_id.toString(),
                                consumerLicense: item.consumer_license.toString(),
                                birthDate: item.consumer_birth_date.substring(0, 10),
                                compoundName: item.consumer_name,
                                orderDate: item.created_at.substring(0, 10),
                            }, function(response)  {
                                if (chrome.runtime.lastError) {
                                    console.warn("InjectMJ: processOpenOrdersResponse:", chrome.runtime.lastError.message);
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
    try {
        const patientSearchResultsMJ = JSON.parse(responseData);
        if (patientSearchResultsMJ.results.length > 0) {
            patientSearchResultsMJ.results.forEach((patient) => {
                if (chrome && chrome.runtime) {
                    // Make a request:
                    let facilityNameFromPage = getFacilityNameFromWebpage();
                    let message = {
                        endPoint: "MJ_patients",
                        webPageFacilityName: facilityNameFromPage
                    };
                    if (patient.organization_id) { message.organization_id = patient.organization_id.toString(); }
                    if (patient.consumer_id) { message.consumerID = patient.consumer_id.toString(); }
                    if (patient.consumer_name) { message.compoundName = patient.consumer_name; }
                    if (patient.med_license_number_latest) { message.consumerLicense = patient.med_license_number_latest.toString(); }
                    if (patient.first_name) { message.firstName = patient.first_name; }
                    if (patient.last_name) { message.lastName = patient.last_name; }
                    if (patient.patient_state_id) { message.stateID = patient.patient_state_id.toString(); }
                    if (patient.birth_date) { message.birthDate = patient.birth_date.substring(0, 10); }
                    chrome.runtime.sendMessage(extensionID, message, function(response) {
                        if (chrome.runtime.lastError) {
                            console.warn("InjectMJ: processMJPatientResponse:", chrome.runtime.lastError.message);
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
    let transactions = {};
    try {
        const myObj = JSON.parse(responseData);
        myObj.forEach((transaction) => {
            if (transaction.consumer_id && transaction.consumer_name) {
                transactions[transaction.consumer_id.toString()] = transaction.consumer_name;
            }
        })
        if (chrome && chrome.runtime) {
            // Make a request:
            let facilityNameFromWebpage = getFacilityNameFromWebpage();
            chrome.runtime.sendMessage(extensionID,
                {
                    endPoint: "MJ_daily_transaction_report",
                    webPageFacilityName: facilityNameFromWebpage,
                    transactions: transactions,
                }, function (response) {
                if (chrome.runtime.lastError) {
                    console.warn("InjectMJ: processMJDailyTransactionsResponse:", chrome.runtime.lastError.message);
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
    if (responseData) {
        try {
            const myObj = JSON.parse(responseData);
            if (myObj.environment.facility_id) {
                // Check if extension is installed
                if (chrome && chrome.runtime) {
                    // Make a request:
                    chrome.runtime.sendMessage(
                        extensionID,
                        {
                            messageFor: 'setFacilityID',
                            facilityId: myObj.environment.facility_id.toString(),
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
function getFacilityNameFromWebpage() {
    let container = document.getElementsByClassName('hidden-xs');
    if (container[0]) {
        return container[0].innerHTML.substring(document.getElementsByClassName('hidden-xs')[0].innerHTML.indexOf('-') + 2);
    }
}
function setNativeValue(element, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;

    if (valueSetter && valueSetter !== prototypeValueSetter) {
        prototypeValueSetter.call(element, value);
    } else {
        valueSetter.call(element, value);
    }
}

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
})