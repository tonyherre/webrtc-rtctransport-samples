# Cross Page RTC Transport Example

This example demonstrates how to use the `RtcTransport` API to send and receive data between two different pages.

## How to run the example

1.  Open two browser windows.
2.  In the first window, navigate to `cross_page/index.html?iceControlling=true`.
3.  In the second window, navigate to `cross_page/index.html?iceControlling=false`.
4.  Copy the ICE candidates from the first window and paste them into the second window.
5.  Copy the ICE candidates from the second window and paste them into the first window.
6.  The two pages should now be connected.

## How to use the example

1.  Type a message in the text area and click the "Send" button to send a message to the other page.
2.  The received messages will be displayed in the status area.
