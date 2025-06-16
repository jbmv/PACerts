// const extensionID = "pknjbljkccmnjiibcmjiefofiaopbcnl";
// (function(xhr) {
//     var XHR = XMLHttpRequest.prototype;
//     var open = XHR.open;
//     var send = XHR.send;
//     var setRequestHeader = XHR.setRequestHeader;
//     XHR.open = function(method, url) {
//         this._method = method;
//         this._url = url;
//         this._requestHeaders = {};
//         this._startTime = (new Date()).toISOString();
//         return open.apply(this, arguments);
//     };
//     XHR.setRequestHeader = function(header, value) {
//         this._requestHeaders[header] = value;
//         return setRequestHeader.apply(this, arguments);
//     };
//     XHR.send = function(postData) {
//         this.addEventListener('load', function() {
//             var endTime = (new Date()).toISOString();
//             var myUrl = this._url ? this._url.toLowerCase() : this._url;
//             if(myUrl) {
//                 if ((myUrl.indexOf('patient-certifications-med') !== -1)) { let responseData = this.response; if (responseData) { sendDOHCertInfo(responseData); }}
//             }
//         });
//         return send.apply(this, arguments);
//     };
// })(XMLHttpRequest);
//
// function sendDOHCertInfo(responseData) {
//
// }
//
// function facilityIDMJSet(responseData) {
//     if (responseData) {
//         try {
//             const myObj = JSON.parse(responseData);
//             if (myObj.environment.facility_id) {
//                 // Check if extension is installed
//                 if (chrome && chrome.runtime) {
//                     // Make a request:
//                     chrome.runtime.sendMessage(
//                         extensionID,
//                         {
//                             messageFor: 'setFacilityID',
//                             facilityId: myObj.environment.facility_id.toString(),
//                         }, function (response) {
//                             if (chrome.runtime.lastError) {
//                                 console.warn("InjectMJ: facilityIDMJSet:", chrome.runtime.lastError.message);
//                             } else if (response) {
//                                 console.log("injectMJ facilityIDMJSet recieved response:", response);
//                             }
//                         })
//                 }
//             }
//         } catch (e) {
//             console.log("error parsing JSON:", e);
//         }
//     }
//
// }
//
// list = document.getElementById("patientcertlist")
// numCerts = list.getElementsByTagName('tr').length - 1